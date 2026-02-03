import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";

import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";

import type { ResolvedAgentAccount } from "./types/index.js";
import type { ResolvedBotAccount } from "./types/index.js";
import type { WecomInboundMessage, WecomInboundQuote } from "./types.js";
import { decryptWecomEncrypted, encryptWecomPlaintext, verifyWecomSignature, computeWecomMsgSignature } from "./crypto.js";
import { getWecomRuntime } from "./runtime.js";
import { decryptWecomMedia } from "./media.js";
import { WEBHOOK_PATHS } from "./types/constants.js";
import { handleAgentWebhook } from "./agent/index.js";
import axios from "axios";

export type WecomRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

type WecomWebhookTarget = {
  account: ResolvedBotAccount;
  config: OpenClawConfig;
  runtime: WecomRuntimeEnv;
  core: PluginRuntime;
  path: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

type StreamState = {
  streamId: string;
  msgid?: string;
  createdAt: number;
  updatedAt: number;
  started: boolean;
  finished: boolean;
  error?: string;
  content: string;
  images?: { base64: string; md5: string }[];
};

const webhookTargets = new Map<string, WecomWebhookTarget[]>();
const streams = new Map<string, StreamState>();
const msgidToStreamId = new Map<string, string>();
const activeReplies = new Map<string, { response_url: string; createdAt: number; usedAt?: number; lastError?: string }>();

// Agent 模式 target 存储
type AgentWebhookTarget = {
  agent: ResolvedAgentAccount;
  config: OpenClawConfig;
  runtime: WecomRuntimeEnv;
};
const agentTargets = new Map<string, AgentWebhookTarget>();

// Pending inbound messages for debouncing rapid consecutive messages
type PendingInbound = {
  streamId: string;
  target: WecomWebhookTarget;
  msg: WecomInboundMessage;
  contents: string[];
  media?: { buffer: Buffer; contentType: string; filename: string };
  msgids: string[];
  nonce: string;
  timestamp: string;
  timeout: ReturnType<typeof setTimeout> | null;
  createdAt: number;
};
const pendingInbounds = new Map<string, PendingInbound>();

const STREAM_TTL_MS = 10 * 60 * 1000;
const ACTIVE_REPLY_TTL_MS = 60 * 60 * 1000;
const STREAM_MAX_BYTES = 20_480;
const DEFAULT_DEBOUNCE_MS = 500;

/** 错误提示信息 */
const ERROR_HELP = "\n\n遇到问题？联系作者: YanHaidao (微信: YanHaidao)";

function normalizeWebhookPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) return withSlash.slice(0, -1);
  return withSlash;
}

function pruneStreams(): void {
  const cutoff = Date.now() - STREAM_TTL_MS;
  for (const [id, state] of streams.entries()) {
    if (state.updatedAt < cutoff) {
      streams.delete(id);
    }
  }
  for (const [msgid, id] of msgidToStreamId.entries()) {
    if (!streams.has(id)) {
      msgidToStreamId.delete(msgid);
    }
  }

  const activeCutoff = Date.now() - ACTIVE_REPLY_TTL_MS;
  for (const [streamId, state] of activeReplies.entries()) {
    if (state.createdAt < activeCutoff) activeReplies.delete(streamId);
  }
}

function truncateUtf8Bytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  const slice = buf.subarray(buf.length - maxBytes);
  return slice.toString("utf8");
}

function jsonOk(res: ServerResponse, body: unknown): void {
  res.statusCode = 200;
  // WeCom's reference implementation returns the encrypted JSON as text/plain.
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  return await new Promise<{ ok: boolean; value?: unknown; error?: string }>((resolve) => {
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        resolve({ ok: false, error: "payload too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) {
          resolve({ ok: false, error: "empty payload" });
          return;
        }
        resolve({ ok: true, value: JSON.parse(raw) as unknown });
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
    req.on("error", (err) => {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    });
  });
}

function buildEncryptedJsonReply(params: {
  account: ResolvedWecomAccount;
  plaintextJson: unknown;
  nonce: string;
  timestamp: string;
}): { encrypt: string; msgsignature: string; timestamp: string; nonce: string } {
  const plaintext = JSON.stringify(params.plaintextJson ?? {});
  const encrypt = encryptWecomPlaintext({
    encodingAESKey: params.account.encodingAESKey ?? "",
    receiveId: params.account.receiveId ?? "",
    plaintext,
  });
  const msgsignature = computeWecomMsgSignature({
    token: params.account.token ?? "",
    timestamp: params.timestamp,
    nonce: params.nonce,
    encrypt,
  });
  return {
    encrypt,
    msgsignature,
    timestamp: params.timestamp,
    nonce: params.nonce,
  };
}

function resolveQueryParams(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams;
}

function resolvePath(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", "http://localhost");
  return normalizeWebhookPath(url.pathname || "/");
}

function resolveSignatureParam(params: URLSearchParams): string {
  return (
    params.get("msg_signature") ??
    params.get("msgsignature") ??
    params.get("signature") ??
    ""
  );
}

function buildStreamPlaceholderReply(params: {
  streamId: string;
  placeholderContent?: string;
}): { msgtype: "stream"; stream: { id: string; finish: boolean; content: string } } {
  const content = params.placeholderContent?.trim() || "1";
  return {
    msgtype: "stream",
    stream: {
      id: params.streamId,
      finish: false,
      // Spec: "第一次回复内容为 1" works as a minimal placeholder.
      content,
    },
  };
}

function buildStreamReplyFromState(state: StreamState): { msgtype: "stream"; stream: { id: string; finish: boolean; content: string } } {
  const content = truncateUtf8Bytes(state.content, STREAM_MAX_BYTES);
  return {
    msgtype: "stream",
    stream: {
      id: state.streamId,
      finish: state.finished,
      content,
      ...(state.finished && state.images?.length ? {
        msg_item: state.images.map(img => ({
          msgtype: "image",
          image: { base64: img.base64, md5: img.md5 }
        }))
      } : {})
    },
  };
}

function createStreamId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function storeActiveReply(streamId: string, responseUrl?: string): void {
  const url = responseUrl?.trim();
  if (!url) return;
  activeReplies.set(streamId, { response_url: url, createdAt: Date.now() });
}

function getActiveReplyUrl(streamId: string): string | undefined {
  return activeReplies.get(streamId)?.response_url;
}

async function useActiveReplyOnce(streamId: string, send: (responseUrl: string) => Promise<void>): Promise<void> {
  const state = activeReplies.get(streamId);
  if (!state?.response_url) throw new Error(`No response_url for stream ${streamId}`);
  if (state.usedAt) throw new Error(`response_url already used for stream ${streamId}`);
  try {
    await send(state.response_url);
    state.usedAt = Date.now();
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

function normalizeWecomAllowFromEntry(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^wecom:/, "")
    .replace(/^user:/, "")
    .replace(/^userid:/, "");
}

function isWecomSenderAllowed(senderUserId: string, allowFrom: string[]): boolean {
  const list = allowFrom.map((entry) => normalizeWecomAllowFromEntry(entry)).filter(Boolean);
  if (list.includes("*")) return true;
  const normalizedSender = normalizeWecomAllowFromEntry(senderUserId);
  if (!normalizedSender) return false;
  return list.includes(normalizedSender);
}

function logVerbose(target: WecomWebhookTarget, message: string): void {
  const should =
    target.core.logging?.shouldLogVerbose?.() ??
    (() => {
      try {
        return getWecomRuntime().logging.shouldLogVerbose();
      } catch {
        return false;
      }
    })();
  if (!should) return;
  target.runtime.log?.(`[wecom] ${message}`);
}

function parseWecomPlainMessage(raw: string): WecomInboundMessage {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  return parsed as WecomInboundMessage;
}

type InboundResult = {
  body: string;
  media?: {
    buffer: Buffer;
    contentType: string;
    filename: string;
  };
};

async function processInboundMessage(target: WecomWebhookTarget, msg: WecomInboundMessage): Promise<InboundResult> {
  const msgtype = String(msg.msgtype ?? "").toLowerCase();
  const aesKey = target.account.encodingAESKey;
  const mediaMaxMb = target.config.mediaMaxMb ?? 5; // Default 5MB
  const maxBytes = mediaMaxMb * 1024 * 1024;

  if (msgtype === "image") {
    const url = String((msg as any).image?.url ?? "").trim();
    if (url && aesKey) {
      try {
        const buf = await decryptWecomMedia(url, aesKey, maxBytes);
        return {
          body: "[image]",
          media: {
            buffer: buf,
            contentType: "image/jpeg", // WeCom images are usually generic; safest assumption or could act as generic
            filename: "image.jpg",
          }
        };
      } catch (err) {
        target.runtime.error?.(`Failed to decrypt inbound image: ${String(err)}`);
        return { body: `[image] (decryption failed: ${typeof err === 'object' && err ? (err as any).message : String(err)})` };
      }
    }
  }

  if (msgtype === "file") {
    const url = String((msg as any).file?.url ?? "").trim();
    if (url && aesKey) {
      try {
        const buf = await decryptWecomMedia(url, aesKey, maxBytes);
        return {
          body: "[file]",
          media: {
            buffer: buf,
            contentType: "application/octet-stream",
            filename: "file.bin", // WeCom doesn't guarantee filename in webhook payload always, defaulting
          }
        };
      } catch (err) {
        target.runtime.error?.(`Failed to decrypt inbound file: ${String(err)}`);
        return { body: `[file] (decryption failed: ${typeof err === 'object' && err ? (err as any).message : String(err)})` };
      }
    }
  }

  // Mixed message handling: extract first media if available
  if (msgtype === "mixed") {
    const items = (msg as any).mixed?.msg_item;
    if (Array.isArray(items)) {
      let foundMedia: InboundResult["media"] | undefined = undefined;
      let bodyParts: string[] = [];

      for (const item of items) {
        const t = String(item.msgtype ?? "").toLowerCase();
        if (t === "text") {
          const content = String(item.text?.content ?? "").trim();
          if (content) bodyParts.push(content);
        } else if ((t === "image" || t === "file") && !foundMedia && aesKey) {
          // Found first media, try to download
          const url = String(item[t]?.url ?? "").trim();
          if (url) {
            try {
              const buf = await decryptWecomMedia(url, aesKey, maxBytes);
              foundMedia = {
                buffer: buf,
                contentType: t === "image" ? "image/jpeg" : "application/octet-stream",
                filename: t === "image" ? "image.jpg" : "file.bin"
              };
              bodyParts.push(`[${t}]`);
            } catch (err) {
              target.runtime.error?.(`Failed to decrypt mixed ${t}: ${String(err)}`);
              bodyParts.push(`[${t}] (decryption failed)`);
            }
          } else {
            bodyParts.push(`[${t}]`);
          }
        } else {
          // Other items or already found media -> just placeholder
          bodyParts.push(`[${t}]`);
        }
      }
      return {
        body: bodyParts.join("\n"),
        media: foundMedia
      };
    }
  }

  return { body: buildInboundBody(msg) };
}

/**
 * Flush pending inbound messages after debounce timeout.
 * Merges all buffered message contents and starts agent processing.
 */
async function flushPending(pendingKey: string): Promise<void> {
  const pending = pendingInbounds.get(pendingKey);
  if (!pending) return;
  pendingInbounds.delete(pendingKey);

  if (pending.timeout) {
    clearTimeout(pending.timeout);
    pending.timeout = null;
  }

  const { streamId, target, msg, contents, media, msgids } = pending;

  // Merge all message contents (each is already formatted by buildInboundBody)
  const mergedContents = contents.filter(c => c.trim()).join("\n").trim();

  let core: PluginRuntime | null = null;
  try {
    core = getWecomRuntime();
  } catch (err) {
    logVerbose(target, `flush pending: runtime not ready: ${String(err)}`);
    const state = streams.get(streamId);
    if (state) {
      state.finished = true;
      state.updatedAt = Date.now();
    }
    return;
  }

  if (core) {
    const state = streams.get(streamId);
    if (state) state.started = true;
    const enrichedTarget: WecomWebhookTarget = { ...target, core };
    logVerbose(target, `flush pending: starting agent for ${contents.length} merged messages`);

    // Pass the first msg (with its media structure), and mergedContents for multi-message context
    startAgentForStream({
      target: enrichedTarget,
      accountId: target.account.accountId,
      msg,
      streamId,
      mergedContents: contents.length > 1 ? mergedContents : undefined,
      mergedMsgids: msgids.length > 1 ? msgids : undefined,
    }).catch((err) => {
      const state = streams.get(streamId);
      if (state) {
        state.error = err instanceof Error ? err.message : String(err);
        state.content = state.content || `Error: ${state.error}`;
        state.finished = true;
        state.updatedAt = Date.now();
      }
      target.runtime.error?.(`[${target.account.accountId}] wecom agent failed: ${String(err)}`);
    });
  }
}

async function waitForStreamContent(streamId: string, maxWaitMs: number): Promise<void> {
  if (maxWaitMs <= 0) return;
  const startedAt = Date.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const state = streams.get(streamId);
      if (!state) return resolve();
      if (state.error || state.finished) return resolve();
      if (state.content.trim()) return resolve();
      if (Date.now() - startedAt >= maxWaitMs) return resolve();
      setTimeout(tick, 25);
    };
    tick();
  });
}

async function startAgentForStream(params: {
  target: WecomWebhookTarget;
  accountId: string;
  msg: WecomInboundMessage;
  streamId: string;
  mergedContents?: string; // Combined content from debounced messages
  mergedMsgids?: string[];
}): Promise<void> {
  const { target, msg, streamId } = params;
  const core = target.core;
  const config = target.config;
  const account = target.account;

  const userid = msg.from?.userid?.trim() || "unknown";
  const chatType = msg.chattype === "group" ? "group" : "direct";
  const chatId = msg.chattype === "group" ? (msg.chatid?.trim() || "unknown") : userid;
  // 1. Process inbound message (decrypt media if any)
  const { body: rawBody, media } = await processInboundMessage(target, msg);

  // 2. Save media if present
  let mediaPath: string | undefined;
  let mediaType: string | undefined;
  if (media) {
    try {
      const maxBytes = (target.config.mediaMaxMb ?? 5) * 1024 * 1024;
      const saved = await core.channel.media.saveMediaBuffer(
        media.buffer,
        media.contentType,
        "inbound",
        maxBytes,
        media.filename
      );
      mediaPath = saved.path;
      mediaType = saved.contentType;
      logVerbose(target, `saved inbound media to ${mediaPath} (${mediaType})`);
    } catch (err) {
      target.runtime.error?.(`Failed to save inbound media: ${String(err)}`);
    }
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "wecom",
    accountId: account.accountId,
    peer: { kind: chatType === "group" ? "group" : "dm", id: chatId },
  });

  logVerbose(target, `starting agent processing (streamId=${streamId}, agentId=${route.agentId}, peerKind=${chatType}, peerId=${chatId})`);

  const fromLabel = chatType === "group" ? `group:${chatId}` : `user:${userid}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "WeCom",
    from: fromLabel,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const dmPolicy = account.config.dm?.policy ?? "pairing";
  const configAllowFrom = (account.config.dm?.allowFrom ?? []).map((v) => String(v));
  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(rawBody, config);
  const storeAllowFrom =
    dmPolicy !== "open" || shouldComputeAuth
      ? await core.channel.pairing.readAllowFromStore("wecom").catch(() => [])
      : [];
  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom];
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowed = isWecomSenderAllowed(userid, effectiveAllowFrom);
  const allowAllConfigured = effectiveAllowFrom.some((entry) => normalizeWecomAllowFromEntry(entry) === "*");
  const authorizerConfigured = allowAllConfigured || effectiveAllowFrom.length > 0;
  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
      useAccessGroups,
      authorizers: [{ configured: authorizerConfigured, allowed: senderAllowed }],
      // When access groups are enabled, authorizers must be configured; if the
      // allowlist is empty, keep commands gated off by default.
    })
    : undefined;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: chatType === "group" ? `wecom:group:${chatId}` : `wecom:${userid}`,
    To: `wecom:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: chatType,
    ConversationLabel: fromLabel,
    SenderName: userid,
    SenderId: userid,
    Provider: "wecom",
    Surface: "wecom",
    MessageSid: msg.msgid,
    CommandAuthorized: commandAuthorized,
    OriginatingChannel: "wecom",
    OriginatingTo: `wecom:${chatId}`,
    MediaPath: mediaPath,
    MediaType: mediaType,
    MediaUrl: mediaPath, // Local path for now
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      target.runtime.error?.(`wecom: failed updating session meta: ${String(err)}`);
    },
  });

  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "wecom",
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload) => {
        let text = payload.text ?? "";

        // Protect <think> tags from table conversion
        const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
        const thinks: string[] = [];
        text = text.replace(thinkRegex, (match: string) => {
          thinks.push(match);
          return `__THINK_PLACEHOLDER_${thinks.length - 1}__`;
        });

        // [A2UI] Detect template_card JSON output from Agent
        const trimmedText = text.trim();
        if (trimmedText.startsWith("{") && trimmedText.includes('"template_card"')) {
          try {
            const parsed = JSON.parse(trimmedText);
            if (parsed.template_card) {
              const isSingleChat = msg.chattype !== "group";
              const responseUrl = getActiveReplyUrl(streamId);

              if (responseUrl && isSingleChat) {
                // 单聊且有 response_url：发送卡片
                await useActiveReplyOnce(streamId, async (url) => {
                  await axios.post(url, {
                    msgtype: "template_card",
                    template_card: parsed.template_card,
                  });
                });
                logVerbose(target, `sent template_card: task_id=${parsed.template_card.task_id}`);
                const current = streams.get(streamId);
                if (!current) return;
                current.finished = true;
                current.content = "[已发送交互卡片]";
                current.updatedAt = Date.now();
                target.statusSink?.({ lastOutboundAt: Date.now() });
                return;
              } else {
                // 群聊 或 无 response_url：降级为文本描述
                logVerbose(target, `template_card fallback to text (group=${!isSingleChat}, hasUrl=${!!responseUrl})`);
                const cardTitle = parsed.template_card.main_title?.title || "交互卡片";
                const cardDesc = parsed.template_card.main_title?.desc || "";
                const buttons = parsed.template_card.button_list?.map((b: any) => b.text).join(" / ") || "";
                text = `📋 **${cardTitle}**${cardDesc ? `\n${cardDesc}` : ""}${buttons ? `\n\n选项: ${buttons}` : ""}`;
              }
            }
          } catch { /* parse fail, use normal text */ }
        }

        text = core.channel.text.convertMarkdownTables(text, tableMode);

        // Restore <think> tags
        thinks.forEach((think, i) => {
          text = text.replace(`__THINK_PLACEHOLDER_${i}__`, think);
        });

        const current = streams.get(streamId);
        if (!current) return;

        if (!current.images) current.images = [];

        const mediaUrls = payload.mediaUrls || (payload.mediaUrl ? [payload.mediaUrl] : []);
        for (const mediaPath of mediaUrls) {
          try {
            let buf: Buffer;
            let contentType: string | undefined;
            let filename: string;

            const looksLikeUrl = /^https?:\/\//i.test(mediaPath);

            if (looksLikeUrl) {
              const loaded = await core.channel.media.fetchRemoteMedia(mediaPath, {
                maxBytes: 10 * 1024 * 1024,
              });
              buf = loaded.buffer;
              contentType = loaded.contentType;
              filename = loaded.filename ?? "attachment";
            } else {
              const fs = await import("node:fs/promises");
              const pathModule = await import("node:path");
              buf = await fs.readFile(mediaPath);
              filename = pathModule.basename(mediaPath);
              const ext = pathModule.extname(mediaPath).slice(1).toLowerCase();
              const imageExts: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
              contentType = imageExts[ext] ?? "application/octet-stream";
            }

            if (contentType?.startsWith("image/")) {
              const base64 = buf.toString("base64");
              const md5 = crypto.createHash("md5").update(buf).digest("hex");
              current.images.push({ base64, md5 });
            } else {
              text += `\n\n[File: ${filename}]`;
            }
          } catch (err) {
            target.runtime.error?.(`Failed to process outbound media: ${mediaPath}: ${String(err)}`);
          }
        }

        const nextText = current.content
          ? `${current.content}\n\n${text}`.trim()
          : text.trim();
        current.content = truncateUtf8Bytes(nextText, STREAM_MAX_BYTES);
        current.updatedAt = Date.now();
        target.statusSink?.({ lastOutboundAt: Date.now() });
      },
      onError: (err, info) => {
        target.runtime.error?.(`[${account.accountId}] wecom ${info.kind} reply failed: ${String(err)}`);
      },
    },
  });

  const current = streams.get(streamId);
  if (current) {
    current.finished = true;
    current.updatedAt = Date.now();
  }
}

function formatQuote(quote: WecomInboundQuote): string {
  const type = quote.msgtype ?? "";
  if (type === "text") return quote.text?.content || "";
  if (type === "image") return `[引用: 图片] ${quote.image?.url || ""}`;
  if (type === "mixed" && quote.mixed?.msg_item) {
    const items = quote.mixed.msg_item.map((item) => {
      if (item.msgtype === "text") return item.text?.content;
      if (item.msgtype === "image") return `[图片] ${item.image?.url || ""}`;
      return "";
    }).filter(Boolean).join(" ");
    return `[引用: 图文] ${items}`;
  }
  if (type === "voice") return `[引用: 语音] ${quote.voice?.content || ""}`;
  if (type === "file") return `[引用: 文件] ${quote.file?.url || ""}`;
  return "";
}

function buildInboundBody(msg: WecomInboundMessage): string {
  let body = "";
  const msgtype = String(msg.msgtype ?? "").toLowerCase();

  if (msgtype === "text") body = (msg as any).text?.content || "";
  else if (msgtype === "voice") body = (msg as any).voice?.content || "[voice]";
  else if (msgtype === "mixed") {
    const items = (msg as any).mixed?.msg_item;
    if (Array.isArray(items)) {
      body = items.map((item: any) => {
        const t = String(item?.msgtype ?? "").toLowerCase();
        if (t === "text") return item?.text?.content || "";
        if (t === "image") return `[image] ${item?.image?.url || ""}`;
        return `[${t || "item"}]`;
      }).filter(Boolean).join("\n");
    } else body = "[mixed]";
  } else if (msgtype === "image") body = `[image] ${(msg as any).image?.url || ""}`;
  else if (msgtype === "file") body = `[file] ${(msg as any).file?.url || ""}`;
  else if (msgtype === "event") body = `[event] ${(msg as any).event?.eventtype || ""}`;
  else if (msgtype === "stream") body = `[stream_refresh] ${(msg as any).stream?.id || ""}`;
  else body = msgtype ? `[${msgtype}]` : "";

  const quote = (msg as any).quote;
  if (quote) {
    const quoteText = formatQuote(quote).trim();
    if (quoteText) body += `\n\n> ${quoteText}`;
  }
  return body;
}

export function registerWecomWebhookTarget(target: WecomWebhookTarget): () => void {
  const key = normalizeWebhookPath(target.path);
  const normalizedTarget = { ...target, path: key };
  const existing = webhookTargets.get(key) ?? [];
  webhookTargets.set(key, [...existing, normalizedTarget]);
  return () => {
    const updated = (webhookTargets.get(key) ?? []).filter((entry) => entry !== normalizedTarget);
    if (updated.length > 0) webhookTargets.set(key, updated);
    else webhookTargets.delete(key);
  };
}

/**
 * 注册 Agent 模式 Webhook Target
 */
export function registerAgentWebhookTarget(target: AgentWebhookTarget): () => void {
  const key = WEBHOOK_PATHS.AGENT;
  agentTargets.set(key, target);
  return () => {
    agentTargets.delete(key);
  };
}

export async function handleWecomWebhookRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  pruneStreams();
  const path = resolvePath(req);

  // Agent 模式路由: /wecom/agent
  if (path === WEBHOOK_PATHS.AGENT) {
    const agentTarget = agentTargets.get(WEBHOOK_PATHS.AGENT);
    if (agentTarget) {
      const core = getWecomRuntime();
      return handleAgentWebhook({
        req,
        res,
        agent: agentTarget.agent,
        config: agentTarget.config,
        core,
        log: agentTarget.runtime.log,
        error: agentTarget.runtime.error,
      });
    }
    // 未注册 Agent，返回 404
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`agent not configured - Agent 模式未配置，请运行 openclaw onboarding${ERROR_HELP}`);
    return true;
  }

  // Bot 模式路由: /wecom, /wecom/bot
  const targets = webhookTargets.get(path);
  if (!targets || targets.length === 0) return false;

  const query = resolveQueryParams(req);
  const timestamp = query.get("timestamp") ?? "";
  const nonce = query.get("nonce") ?? "";
  const signature = resolveSignatureParam(query);

  if (req.method === "GET") {
    const echostr = query.get("echostr") ?? "";
    const target = targets.find(c => c.account.token && verifyWecomSignature({ token: c.account.token, timestamp, nonce, encrypt: echostr, signature }));
    if (!target || !target.account.encodingAESKey) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`unauthorized - Bot 签名验证失败，请检查 Token 配置${ERROR_HELP}`);
      return true;
    }
    try {
      const plain = decryptWecomEncrypted({ encodingAESKey: target.account.encodingAESKey, receiveId: target.account.receiveId, encrypt: echostr });
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(plain);
      return true;
    } catch (err) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`decrypt failed - 解密失败，请检查 EncodingAESKey${ERROR_HELP}`);
      return true;
    }
  }

  if (req.method !== "POST") return false;

  const body = await readJsonBody(req, 1024 * 1024);
  if (!body.ok) {
    res.statusCode = 400;
    res.end(body.error || "invalid payload");
    return true;
  }
  const record = body.value as any;
  const encrypt = String(record?.encrypt ?? record?.Encrypt ?? "");
  const target = targets.find(c => c.account.token && verifyWecomSignature({ token: c.account.token, timestamp, nonce, encrypt, signature }));
  if (!target || !target.account.configured || !target.account.encodingAESKey) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`unauthorized - Bot 签名验证失败${ERROR_HELP}`);
    return true;
  }

  let plain: string;
  try {
    plain = decryptWecomEncrypted({ encodingAESKey: target.account.encodingAESKey, receiveId: target.account.receiveId, encrypt });
  } catch (err) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`decrypt failed - 解密失败${ERROR_HELP}`);
    return true;
  }

  const msg = parseWecomPlainMessage(plain);
  const msgtype = String(msg.msgtype ?? "").toLowerCase();

  // Handle Event
  if (msgtype === "event") {
    const eventtype = String((msg as any).event?.eventtype ?? "").toLowerCase();

    if (eventtype === "template_card_event") {
      const msgid = msg.msgid ? String(msg.msgid) : undefined;

      // Dedupe: skip if already processed this event
      if (msgid && msgidToStreamId.has(msgid)) {
        logVerbose(target, `template_card_event: already processed msgid=${msgid}, skipping`);
        jsonOk(res, buildEncryptedJsonReply({ account: target.account, plaintextJson: {}, nonce, timestamp }));
        return true;
      }

      const cardEvent = (msg as any).event?.template_card_event;
      let interactionDesc = `[卡片交互] 按钮: ${cardEvent?.event_key || "unknown"}`;
      if (cardEvent?.selected_items?.selected_item?.length) {
        const selects = cardEvent.selected_items.selected_item.map((i: any) => `${i.question_key}=${i.option_ids?.option_id?.join(",")}`);
        interactionDesc += ` 选择: ${selects.join("; ")}`;
      }
      if (cardEvent?.task_id) interactionDesc += ` (任务ID: ${cardEvent.task_id})`;

      jsonOk(res, buildEncryptedJsonReply({ account: target.account, plaintextJson: {}, nonce, timestamp }));

      const streamId = createStreamId();
      if (msgid) msgidToStreamId.set(msgid, streamId); // Mark as processed
      streams.set(streamId, { streamId, createdAt: Date.now(), updatedAt: Date.now(), started: true, finished: false, content: "" });
      storeActiveReply(streamId, msg.response_url);
      const core = getWecomRuntime();
      startAgentForStream({
        target: { ...target, core },
        accountId: target.account.accountId,
        msg: { ...msg, msgtype: "text", text: { content: interactionDesc } } as any,
        streamId,
      }).catch(err => target.runtime.error?.(`interaction failed: ${String(err)}`));
      return true;
    }

    if (eventtype === "enter_chat") {
      const welcome = target.account.config.welcomeText?.trim();
      jsonOk(res, buildEncryptedJsonReply({ account: target.account, plaintextJson: welcome ? { msgtype: "text", text: { content: welcome } } : {}, nonce, timestamp }));
      return true;
    }

    jsonOk(res, buildEncryptedJsonReply({ account: target.account, plaintextJson: {}, nonce, timestamp }));
    return true;
  }

  // Handle Stream Refresh
  if (msgtype === "stream") {
    const streamId = String((msg as any).stream?.id ?? "").trim();
    const state = streams.get(streamId);
    const reply = state ? buildStreamReplyFromState(state) : buildStreamReplyFromState({ streamId: streamId || "unknown", createdAt: Date.now(), updatedAt: Date.now(), started: true, finished: true, content: "" });
    jsonOk(res, buildEncryptedJsonReply({ account: target.account, plaintextJson: reply, nonce, timestamp }));
    return true;
  }

  // Handle Message (with Debounce)
  const userid = msg.from?.userid?.trim() || "unknown";
  const chatId = msg.chattype === "group" ? (msg.chatid?.trim() || "unknown") : userid;
  const pendingKey = `wecom:${target.account.accountId}:${userid}:${chatId}`;
  const msgContent = buildInboundBody(msg);

  const existingPending = pendingInbounds.get(pendingKey);
  if (existingPending) {
    existingPending.contents.push(msgContent);
    if (msg.msgid) existingPending.msgids.push(msg.msgid);
    if (existingPending.timeout) clearTimeout(existingPending.timeout);
    existingPending.timeout = setTimeout(() => void flushPending(pendingKey), DEFAULT_DEBOUNCE_MS);
    jsonOk(res, buildEncryptedJsonReply({ account: target.account, plaintextJson: buildStreamPlaceholderReply({ streamId: existingPending.streamId, placeholderContent: target.account.config.streamPlaceholderContent }), nonce, timestamp }));
    return true;
  }

  const streamId = createStreamId();
  if (msg.msgid) msgidToStreamId.set(msg.msgid, streamId);
  streams.set(streamId, { streamId, msgid: msg.msgid, createdAt: Date.now(), updatedAt: Date.now(), started: false, finished: false, content: "" });
  storeActiveReply(streamId, msg.response_url);
  pendingInbounds.set(pendingKey, { streamId, target, msg, contents: [msgContent], msgids: msg.msgid ? [msg.msgid] : [], nonce, timestamp, createdAt: Date.now(), timeout: setTimeout(() => void flushPending(pendingKey), DEFAULT_DEBOUNCE_MS) });

  jsonOk(res, buildEncryptedJsonReply({ account: target.account, plaintextJson: buildStreamPlaceholderReply({ streamId, placeholderContent: target.account.config.streamPlaceholderContent }), nonce, timestamp }));
  return true;
}

export async function sendActiveMessage(streamId: string, content: string): Promise<void> {
  await useActiveReplyOnce(streamId, async (url) => {
    await axios.post(url, { msgtype: "text", text: { content } });
  });
}
