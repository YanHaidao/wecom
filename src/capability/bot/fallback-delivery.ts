import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";

import {
  prepareWecomMarkdownChunks,
  prepareWecomTextChunks,
  resolveWecomAccount,
  resolveWecomMarkdownFormat,
} from "../../config/index.js";
import { WECOM_TEXT_CHUNK_BYTE_LIMIT } from "../agent/delivery-service.js";
import { wecomFetch } from "../../http.js";
import { LIMITS } from "../../monitor/state.js";
import type { StreamState } from "../../types/legacy-stream.js";
import type { ResolvedAgentAccount } from "../../types/index.js";
import {
  sendMarkdown as sendAgentMarkdown,
  sendMedia as sendAgentMedia,
  sendText as sendAgentText,
  uploadMedia,
} from "../../transport/agent-api/core.js";
import { buildStreamReplyFromState } from "../../transport/bot-webhook/protocol.js";
import { useActiveReplyOnce } from "../../transport/bot-webhook/active-reply.js";
import { guessContentTypeFromPath } from "../../transport/bot-webhook/inbound-normalizer.js";

const STREAM_MAX_DM_BYTES = 200_000;

export function appendDmContent(state: StreamState, text: string): void {
  const next = state.dmContent ? `${state.dmContent}\n\n${text}`.trim() : text.trim();
  const buf = Buffer.from(next, "utf8");
  state.dmContent = buf.length <= STREAM_MAX_DM_BYTES ? next : buf.subarray(buf.length - STREAM_MAX_DM_BYTES).toString("utf8");
}

export function resolveAgentAccountOrUndefined(cfg: OpenClawConfig, accountId: string): ResolvedAgentAccount | undefined {
  const agent = resolveWecomAccount({ cfg, accountId }).agent;
  return agent?.configured ? agent : undefined;
}

export function buildFallbackPrompt(params: {
  kind: "media" | "timeout" | "error";
  agentConfigured: boolean;
  userId?: string;
  filename?: string;
  chatType?: "group" | "direct";
}): string {
  const who = params.userId ? `（${params.userId}）` : "";
  const scope = params.chatType === "group" ? "群聊" : params.chatType === "direct" ? "私聊" : "会话";
  if (!params.agentConfigured) {
    return `${scope}中需要通过应用私信发送${params.filename ? `（${params.filename}）` : ""}，但管理员尚未配置企业微信自建应用（Agent）通道。请联系管理员配置后再试。${who}`.trim();
  }
  if (!params.userId) {
    return `${scope}中需要通过应用私信兜底发送${params.filename ? `（${params.filename}）` : ""}，但本次回调未能识别触发者 userid（请检查企微回调字段 from.userid / fromuserid）。请联系管理员排查配置。`.trim();
  }
  if (params.kind === "media") {
    return `已生成文件${params.filename ? `（${params.filename}）` : ""}，将通过应用私信发送给你。${who}`.trim();
  }
  if (params.kind === "timeout") {
    return `内容较长，为避免超时，后续内容将通过应用私信发送给你。${who}`.trim();
  }
  return `交付出现异常，已尝试通过应用私信发送给你。${who}`.trim();
}

export async function sendBotFallbackPromptNow(params: { streamId: string; text: string }): Promise<void> {
  await useActiveReplyOnce(params.streamId, async ({ responseUrl, proxyUrl }) => {
    const payload = {
      msgtype: "stream",
      stream: {
        id: params.streamId,
        finish: true,
        content: params.text.trim() || "1",
      },
    };
    const res = await wecomFetch(
      responseUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      { proxyUrl, timeoutMs: LIMITS.REQUEST_TIMEOUT_MS },
    );
    if (!res.ok) {
      throw new Error(`fallback prompt push failed: ${res.status}`);
    }
  });
}

export async function pushFinalStreamReplyNow(params: { streamId: string; state: StreamState }): Promise<void> {
  const finalReply = buildStreamReplyFromState(params.state) as unknown as Record<string, unknown>;
  await useActiveReplyOnce(params.streamId, async ({ responseUrl, proxyUrl }) => {
    const res = await wecomFetch(
      responseUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalReply),
      },
      { proxyUrl, timeoutMs: LIMITS.REQUEST_TIMEOUT_MS },
    );
    if (!res.ok) {
      throw new Error(`final stream push failed: ${res.status}`);
    }
  });
}

export async function sendAgentDmText(params: {
  agent: ResolvedAgentAccount;
  userId: string;
  text: string;
  core: PluginRuntime;
  cfg: OpenClawConfig;
}): Promise<void> {
  // Bot 超时兜底的 Agent 私信同样不经过 wecomOutbound，所以在这里解析账号配置。
  const asMarkdown =
    resolveWecomMarkdownFormat(params.cfg, params.agent.accountId) === "markdown";
  // 这条兜底路径走的是 Agent message/send（不是群机器人 webhook），
  // 所以上限是 2048 字节。
  const chunks = asMarkdown
    ? prepareWecomMarkdownChunks(params.text, WECOM_TEXT_CHUNK_BYTE_LIMIT)
    : prepareWecomTextChunks(params.text, WECOM_TEXT_CHUNK_BYTE_LIMIT, (value, charLimit) =>
        params.core.channel.text.chunkText(value, charLimit),
      );
  const send = asMarkdown ? sendAgentMarkdown : sendAgentText;
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    await send({ agent: params.agent, toUser: params.userId, text: trimmed });
  }
}

export async function sendAgentDmMedia(params: {
  agent: ResolvedAgentAccount;
  userId: string;
  mediaUrlOrPath: string;
  contentType?: string;
  filename: string;
}): Promise<void> {
  let buffer: Buffer;
  let inferredContentType = params.contentType;
  const looksLikeUrl = /^https?:\/\//i.test(params.mediaUrlOrPath);
  if (looksLikeUrl) {
    const res = await fetch(params.mediaUrlOrPath, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`media download failed: ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
    inferredContentType = inferredContentType || res.headers.get("content-type") || "application/octet-stream";
  } else {
    const fs = await import("node:fs/promises");
    buffer = await fs.readFile(params.mediaUrlOrPath);
  }

  let mediaType: "image" | "voice" | "video" | "file" = "file";
  const ct = (inferredContentType || "").toLowerCase();
  if (ct.startsWith("image/")) mediaType = "image";
  else if (ct.startsWith("audio/")) mediaType = "voice";
  else if (ct.startsWith("video/")) mediaType = "video";

  const mediaId = await uploadMedia({
    agent: params.agent,
    type: mediaType,
    buffer,
    filename: params.filename,
  });
  await sendAgentMedia({
    agent: params.agent,
    toUser: params.userId,
    mediaId,
    mediaType,
  });
}

export function extractLocalImagePathsFromText(params: { text: string; mustAlsoAppearIn: string }): string[] {
  const text = params.text;
  const mustAlsoAppearIn = params.mustAlsoAppearIn;
  if (!text.trim()) return [];
  const exts = "(png|jpg|jpeg|gif|webp|bmp)";
  const re = new RegExp(String.raw`(\/(?:Users|tmp|root|home)\/[^\s"'<>]+?\.${exts})`, "gi");
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const p = m[1];
    if (!p) continue;
    if (!mustAlsoAppearIn.includes(p)) continue;
    found.add(p);
  }
  return Array.from(found);
}

export function extractLocalFilePathsFromText(text: string): string[] {
  if (!text.trim()) return [];
  const re = /\/(?:Users|tmp|root|home)\/[^\s"'<>]+/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const p = m[0]?.trim();
    if (p) found.add(p);
  }
  return Array.from(found);
}

export function guessLocalPathContentType(filePath: string): string | undefined {
  return guessContentTypeFromPath(filePath);
}
