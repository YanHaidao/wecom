/**
 * WeCom Agent Webhook 处理器
 * 处理 XML 格式回调
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import type { WecomAccountRuntime } from "../app/account-runtime.js";
import {
  prepareWecomMarkdownChunks,
  resolveWecomMarkdownFormat,
  resolveWecomMediaMaxBytes,
  shouldRejectWecomDefaultRoute,
} from "../config/index.js";
import {
  buildAgentSessionTarget,
  generateAgentId,
  shouldUseDynamicAgent,
  ensureDynamicAgentListed,
} from "../dynamic-agent.js";
import { setPeerContext } from "../context-store.js";
import { chunkTextToByteLimit } from "../shared/byte-chunking.js";
import { MESSAGE_BYTE_LIMITS } from "../types/constants.js";
import { getWecomRuntime } from "../runtime.js";
import { registerWecomSourceSnapshot } from "../runtime/source-registry.js";
import {
  buildWecomUnauthorizedCommandPrompt,
  resolveWecomCommandAuthorization,
} from "../shared/command-auth.js";
import {
  extractMsgType,
  extractFromUser,
  extractContent,
  extractChatId,
  extractMediaId,
  extractMsgId,
  extractFileName,
  extractAgentId,
  extractToUser,
} from "../shared/xml-parser.js";
import { resolveOutboundMediaAsset } from "../shared/media-asset.js";
import {
  downloadAgentApiMedia,
  downloadUpstreamAgentApiMedia,
  sendAgentApiMarkdown,
  sendAgentApiText,
  sendUpstreamAgentApiMarkdown,
  sendUpstreamAgentApiText,
} from "../transport/agent-api/client.js";
import { deliverAgentApiMedia } from "../transport/agent-api/delivery.js";
import { deliverUpstreamAgentApiMedia } from "../transport/agent-api/upstream-delivery.js";
import type {
  ResolvedAgentAccount,
  ReplyPayload,
  UnifiedInboundEvent,
  WecomInboundKind,
} from "../types/index.js";
import type { WecomAgentInboundMessage } from "../types/index.js";
import type { TransportSessionPatch } from "../types/index.js";
import type { WecomRuntimeAuditEvent } from "../types/runtime-context.js";
import { detectUpstreamUser, createUpstreamAgentConfig, resolveUpstreamCorpConfig } from "../upstream/index.js";

/** 错误提示信息 */
const ERROR_HELP = "\n\n遇到问题？联系作者: YanHaidao (微信: YanHaidao)";

/**
 * Agent 回调回复的分片粒度，单位是字符。
 *
 * 沿用既有的 600：远低于企微 2048 字节上限，是刻意的——分批发送让用户
 * 更早看到内容。所以这里保留字符语义，字节上限由下面的 byte-chunking 兜。
 */
const AGENT_REPLY_CHUNK_CHARS = 600;

/** 定长切分，等价于原先内联的 `slice(i, i + MAX_CHUNK_SIZE)` 循环。 */
function sliceByLength(text: string, limit: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.slice(i, i + limit));
  }
  return chunks;
}

/**
 * 600 字符在多数内容下远低于 2048 字节，但不是所有：emoji 每字符 4 字节，
 * 600 个就是 2400 字节，会超限被企微截断。所以切完再过一遍字节上限。
 */
function enforceReplyByteLimit(chunks: string[]): string[] {
  return chunks.flatMap((chunk) =>
    chunkTextToByteLimit(chunk, MESSAGE_BYTE_LIMITS.AGENT_MESSAGE, sliceByLength),
  );
}

// Agent webhook 幂等去重池（防止企微回调重试导致重复回复）
// 注意：这是进程内内存去重，重启会清空；但足以覆盖企微的短周期重试。
const RECENT_MSGID_TTL_MS = 10 * 60 * 1000;
const recentAgentMsgIds = new Map<string, number>();

// Event deduplication (e.g. for ENTER_AGENT/subscribe welcome messages)
// We only want to send a welcome message once every 5 minutes per user
const RECENT_EVENT_TTL_MS = 3 * 60 * 1000;
const recentAgentEvents = new Map<string, number>();

function rememberAgentEvent(key: string): boolean {
  const now = Date.now();
  const existing = recentAgentEvents.get(key);
  if (existing && now - existing < RECENT_EVENT_TTL_MS) return false;
  recentAgentEvents.set(key, now);
  // Prune expired
  for (const [k, ts] of recentAgentEvents) {
    if (now - ts >= RECENT_EVENT_TTL_MS) recentAgentEvents.delete(k);
  }
  return true;
}

function rememberAgentMsgId(msgId: string): boolean {
  const now = Date.now();
  const existing = recentAgentMsgIds.get(msgId);
  if (existing && now - existing < RECENT_MSGID_TTL_MS) return false;
  recentAgentMsgIds.set(msgId, now);
  // 简单清理：只在写入时做一次线性 prune，避免无界增长
  for (const [k, ts] of recentAgentMsgIds) {
    if (now - ts >= RECENT_MSGID_TTL_MS) recentAgentMsgIds.delete(k);
  }
  return true;
}

function looksLikeTextFile(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 4096);
  if (sampleSize === 0) return true;
  let bad = 0;
  for (let i = 0; i < sampleSize; i++) {
    const b = buffer[i]!;
    const isWhitespace = b === 0x09 || b === 0x0a || b === 0x0d; // \t \n \r
    const isPrintable = b >= 0x20 && b !== 0x7f;
    if (!isWhitespace && !isPrintable) bad++;
  }
  // 非可打印字符占比太高，基本可判断为二进制
  return bad / sampleSize <= 0.02;
}

function analyzeTextHeuristic(buffer: Buffer): {
  sampleSize: number;
  badCount: number;
  badRatio: number;
} {
  const sampleSize = Math.min(buffer.length, 4096);
  if (sampleSize === 0) return { sampleSize: 0, badCount: 0, badRatio: 0 };
  let badCount = 0;
  for (let i = 0; i < sampleSize; i++) {
    const b = buffer[i]!;
    const isWhitespace = b === 0x09 || b === 0x0a || b === 0x0d;
    const isPrintable = b >= 0x20 && b !== 0x7f;
    if (!isWhitespace && !isPrintable) badCount++;
  }
  return { sampleSize, badCount, badRatio: badCount / sampleSize };
}

function previewHex(buffer: Buffer, maxBytes = 32): string {
  const n = Math.min(buffer.length, maxBytes);
  if (n <= 0) return "";
  return buffer.subarray(0, n).toString("hex").replace(/(..)/g, "$1 ").trim();
}

function buildTextFilePreview(buffer: Buffer, maxChars: number): string | undefined {
  if (!looksLikeTextFile(buffer)) return undefined;
  const text = buffer.toString("utf8");
  if (!text.trim()) return undefined;
  const truncated = text.length > maxChars ? `${text.slice(0, maxChars)}\n…(已截断)` : text;
  return truncated;
}

function readContextSessionId(ctx: { SessionId?: string } | Record<string, unknown>): string | undefined {
  const sessionId = "SessionId" in ctx ? ctx.SessionId : undefined;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : undefined;
}

/**
 * **AgentWebhookParams (Webhook 处理器参数)**
 *
 * 传递给 Agent Webhook 处理函数的上下文参数集合。
 * @property req Node.js 原始请求对象
 * @property res Node.js 原始响应对象
 * @property agent 解析后的 Agent 账号信息
 * @property config 全局插件配置
 * @property core OpenClaw 插件运行时
 * @property log 可选日志输出函数
 * @property error 可选错误输出函数
 */
export type AgentWebhookParams = {
  req: IncomingMessage;
  res: ServerResponse;
  /**
   * 上游已完成验签/解密时传入，避免重复协议处理。
   * 仅用于 POST 消息回调流程。
   */
  verifiedPost?: {
    timestamp: string;
    nonce: string;
    signature: string;
    encrypted: string;
    decrypted: string;
    parsed: WecomAgentInboundMessage;
  };
  agent: ResolvedAgentAccount;
  config: OpenClawConfig;
  core: PluginRuntime;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
  auditSink?: (event: WecomRuntimeAuditEvent) => void;
  touchTransportSession?: (patch: TransportSessionPatch) => void;
};

export type AgentInboundProcessDecision = {
  shouldProcess: boolean;
  reason: string;
};

/**
 * 仅允许“用户意图消息”进入 AI 会话。
 * - event 回调（如 enter_agent/subscribe）不应触发会话与自动回复
 * - 系统发送者（sys）不应触发会话与自动回复
 * - 缺失发送者时默认丢弃，避免写入异常会话
 */
export function shouldProcessAgentInboundMessage(params: {
  msgType: string;
  fromUser: string;
  chatId?: string;
  eventType?: string;
}): AgentInboundProcessDecision {
  const msgType = String(params.msgType ?? "")
    .trim()
    .toLowerCase();
  const fromUser = String(params.fromUser ?? "").trim();
  const chatId = String(params.chatId ?? "").trim();
  const normalizedFromUser = fromUser.toLowerCase();
  const eventType = String(params.eventType ?? "")
    .trim()
    .toLowerCase();

  if (msgType === "event") {
    const allowedEvents = [
      "subscribe",
      "enter_agent",
      "batch_job_result",
      // WeCom Doc events
      "doc_create",
      "doc_delete",
      "doc_content_change",
      "doc_member_change",
      // WeCom Form events
      "wedoc_collect_submit",
      // SmartSheet events
      "smartsheet_record_change",
      "smartsheet_field_change",
      "smartsheet_view_change",
    ];
    if (
      allowedEvents.includes(eventType) ||
      eventType.startsWith("doc_") ||
      eventType.startsWith("wedoc_") ||
      eventType.startsWith("smartsheet_")
    ) {
      return {
        shouldProcess: true,
        reason: `allowed_event:${eventType}`,
      };
    }
    return {
      shouldProcess: false,
      reason: `event:${eventType || "unknown"}`,
    };
  }

  if (!fromUser) {
    if (chatId) {
      return {
        shouldProcess: true,
        reason: "missing_sender_but_group_chat",
      };
    }
    return {
      shouldProcess: false,
      reason: "missing_sender",
    };
  }

  if (normalizedFromUser === "sys") {
    return {
      shouldProcess: false,
      reason: "system_sender",
    };
  }

  return {
    shouldProcess: true,
    reason: "user_message",
  };
}

export function shouldSuppressAgentReplyText(params: {
  text: string;
  mediaReplySeen: boolean;
}): boolean {
  return params.mediaReplySeen && Boolean(params.text.trim());
}

function normalizeAgentId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * **resolveQueryParams (解析查询参数)**
 *
 * 辅助函数：从 IncomingMessage 中解析 URL 查询字符串，用于获取签名、时间戳等参数。
 */
function resolveQueryParams(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams;
}

/**
 * 处理消息回调 (POST)
 */
async function handleMessageCallback(params: AgentWebhookParams): Promise<boolean> {
  const { req, res, verifiedPost, agent, config, core, log, error, auditSink } = params;

  try {
    if (!verifiedPost) {
      error?.("[wecom-agent] inbound: missing preverified envelope");
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`invalid request - 缺少上游验签结果${ERROR_HELP}`);
      return true;
    }

    log?.(
      `[wecom-agent] inbound: method=${req.method ?? "UNKNOWN"} remote=${req.socket?.remoteAddress ?? "unknown"}`,
    );
    const query = resolveQueryParams(req);
    const querySignature = query.get("msg_signature") ?? "";

    const encrypted = verifiedPost.encrypted;
    const decrypted = verifiedPost.decrypted;
    const msg = verifiedPost.parsed;
    const timestamp = verifiedPost.timestamp;
    const nonce = verifiedPost.nonce;
    const signature = verifiedPost.signature || querySignature;
    log?.(
      `[wecom-agent] inbound: using preverified envelope timestamp=${timestamp ? "yes" : "no"} nonce=${nonce ? "yes" : "no"} msg_signature=${signature ? "yes" : "no"} encryptLen=${encrypted.length}`,
    );

    log?.(`[wecom-agent] inbound: decryptedBytes=${Buffer.byteLength(decrypted, "utf8")}`);

    const inboundAgentId = normalizeAgentId(extractAgentId(msg));
    if (
      inboundAgentId !== undefined &&
      typeof agent.agentId === "number" &&
      Number.isFinite(agent.agentId) &&
      inboundAgentId !== agent.agentId
    ) {
      error?.(
        `[wecom-agent] inbound: agentId mismatch ignored expectedAgentId=${agent.agentId} actualAgentId=${String(extractAgentId(msg) ?? "")}`,
      );
    }
    const msgType = extractMsgType(msg);
    const fromUser = extractFromUser(msg);
    const chatId = extractChatId(msg);
    const msgId = extractMsgId(msg);
    const eventType = String((msg as Record<string, unknown>).Event ?? "")
      .trim()
      .toLowerCase();

    if (msgId) {
      const ok = rememberAgentMsgId(msgId);
      if (!ok) {
        log?.(
          `[wecom-agent] duplicate msgId=${msgId} from=${fromUser} chatId=${chatId ?? "N/A"} type=${msgType}; skipped`,
        );
        auditSink?.({
          transport: "agent-callback",
          category: "duplicate-reply",
          messageId: msgId,
          summary: `duplicate agent callback from=${fromUser} chatId=${chatId ?? "N/A"} type=${msgType}`,
          raw: {
            transport: "agent-callback",
            envelopeType: "xml",
            body: msg,
          },
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("success");
        return true;
      }
    }

    // Agent 模式下 enter_agent / subscribe 不做任何处理，静默回 success
    if (msgType === "event" && (eventType === "enter_agent" || eventType === "subscribe")) {
      log?.(
        `[wecom-agent] ignoring ${eventType} from=${fromUser}; agent does not handle welcome events`,
      );
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("success");
      return true;
    }
    const content = String(extractContent(msg) ?? "");

    const preview = content.length > 100 ? `${content.slice(0, 100)}…` : content;
    log?.(
      `[wecom-agent] ${msgType} from=${fromUser} chatId=${chatId ?? "N/A"} msgId=${msgId ?? "N/A"} content=${preview}`,
    );

    // 先返回 success (Agent 模式使用 API 发送回复，不用被动回复)
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("success");

    const decision = shouldProcessAgentInboundMessage({
      msgType,
      fromUser,
      chatId,
      eventType,
    });
    if (!decision.shouldProcess) {
      log?.(
        `[wecom-agent] skip processing: type=${msgType || "unknown"} event=${eventType || "N/A"} from=${fromUser || "N/A"} reason=${decision.reason}`,
      );
      return true;
    }

    // 异步处理消息
    processAgentMessage({
      agent,
      config,
      core,
      fromUser,
      chatId,
      msgType,
      content,
      msg,
      log,
      error,
      auditSink,
      touchTransportSession: params.touchTransportSession,
    }).catch((err) => {
      error?.(`[wecom-agent] process failed: ${String(err)}`);
    });

    return true;
  } catch (err) {
    error?.(`[wecom-agent] callback failed: ${String(err)}`);
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`error - 回调处理失败${ERROR_HELP}`);
    return true;
  }
}

/**
 * **processAgentMessage (处理 Agent 消息)**
 *
 * 异步处理解密后的消息内容，并触发 OpenClaw Agent。
 * 流程：
 * 1. 路由解析：根据 userid或群ID 确定 Agent 路由。
 * 2. 媒体处理：如果是图片/文件等，下载资源。
 * 3. 上下文构建：创建 Inbound Context。
 * 4. 会话记录：更新 Session 状态。
 * 5. 调度回复：将 Agent 的响应通过 `api-client` 发送回企业微信。
 */
async function processAgentMessage(params: {
  agent: ResolvedAgentAccount;
  config: OpenClawConfig;
  core: PluginRuntime;
  fromUser: string;
  chatId?: string;
  msgType: string;
  content: string;
  msg: WecomAgentInboundMessage;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
  auditSink?: (event: WecomRuntimeAuditEvent) => void;
  touchTransportSession?: (patch: TransportSessionPatch) => void;
}): Promise<void> {
  const {
    agent,
    config,
    core,
    fromUser,
    chatId,
    content,
    msg,
    msgType,
    log,
    error,
    auditSink,
    touchTransportSession,
  } = params;

  const isGroup = Boolean(chatId);
  const peerId = isGroup ? chatId! : fromUser;
  const replyTarget = isGroup
    ? ({ toUser: undefined, chatId: peerId } as const)
    : ({ toUser: fromUser, chatId: undefined } as const);
  let upstreamAgent: typeof agent | undefined;
  let upstreamReplyTarget: typeof replyTarget | undefined;
  let primaryAgentForUpstream: typeof agent | undefined;
  const eventType = String(msg.Event ?? "")
    .trim()
    .toLowerCase();

  // 检测是否是上下游用户
  const toUserName = extractToUser(msg);
  const isUpstreamUser = detectUpstreamUser({
    messageToUserName: toUserName,
    primaryCorpId: agent.corpId,
  });
  
  if (isUpstreamUser) {
    log?.(
      `[wecom-agent] detected upstream user: from=${fromUser} toCorpId=${toUserName}`,
    );

    // 查找上下游配置，构建上游 Agent 配置
    const upstreamConfig = resolveUpstreamCorpConfig({
      upstreamCorpId: toUserName,
      upstreamCorps: agent.config.upstreamCorps,
    });
    if (upstreamConfig) {
      upstreamAgent = createUpstreamAgentConfig({
        baseAgent: agent,
        upstreamCorpId: toUserName,
        upstreamAgentId: upstreamConfig.agentId,
      });
      primaryAgentForUpstream = agent;
      // 上下游的 replyTarget 与普通 DM 一致（toUser = fromUser）
      upstreamReplyTarget = isGroup
        ? ({ toUser: undefined, chatId: peerId } as const)
        : ({ toUser: fromUser, chatId: undefined } as const);
    } else {
      error?.(
        `[wecom-agent] upstream user detected but no upstream config for corpId=${toUserName}; fallback to primary agent target`,
      );
    }
  }

  const resolveInboundKind = (): WecomInboundKind => {
    if (msgType === "event") {
      if (eventType === "subscribe" || eventType === "enter_agent") return "welcome";
      return "event";
    }
    if (msgType === "image") return "image";
    if (msgType === "voice") return "voice";
    if (msgType === "video") return "video";
    if (msgType === "file") return "file";
    if (msgType === "location") return "location";
    if (msgType === "link") return "link";
    return "text";
  };

  const inboundKind = resolveInboundKind();
  const resolveEventText = (): string => {
    if (inboundKind === "welcome" && agent.config.welcomeText) {
      return agent.config.welcomeText;
    }
    if (msgType === "event") {
      return `[event:${eventType || "unknown"}]`;
    }
    return content;
  };

  // BUG FIX: 真正调用 resolveEventText() 获取欢迎语或事件描述
  const resolvedContent = resolveEventText();
  let finalContent = resolvedContent;

  const mediaMaxBytes = resolveWecomMediaMaxBytes(config, agent.accountId);

  // 处理媒体文件
  const attachments: NonNullable<UnifiedInboundEvent["attachments"]> = [];
  let mediaPath: string | undefined;
  let mediaType: string | undefined;

  if (["image", "voice", "video", "file"].includes(msgType)) {
    const mediaId = extractMediaId(msg);
    if (mediaId) {
      try {
        log?.(`[wecom-agent] downloading media: ${mediaId} (${msgType})`);
        const {
          buffer,
          contentType,
          filename: headerFileName,
        } =
          upstreamAgent && primaryAgentForUpstream
            ? await downloadUpstreamAgentApiMedia({
                upstreamAgent,
                primaryAgent: primaryAgentForUpstream,
                mediaId,
                maxBytes: mediaMaxBytes,
              })
            : await downloadAgentApiMedia({ agent, mediaId, maxBytes: mediaMaxBytes });
        const xmlFileName = extractFileName(msg);
        const originalFileName = (xmlFileName || headerFileName || `${mediaId}.bin`).trim();
        const heuristic = analyzeTextHeuristic(buffer);

        // 推断文件名后缀
        const extMap: Record<string, string> = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/gif": "gif",
          "audio/amr": "amr",
          "audio/speex": "speex",
          "video/mp4": "mp4",
        };
        const textPreview = msgType === "file" ? buildTextFilePreview(buffer, 12_000) : undefined;
        const looksText = Boolean(textPreview);
        const originalExt = path.extname(originalFileName).toLowerCase();
        const normalizedContentType =
          looksText && originalExt === ".md"
            ? "text/markdown"
            : looksText && (!contentType || contentType === "application/octet-stream")
              ? "text/plain; charset=utf-8"
              : contentType;

        const ext = extMap[normalizedContentType] || (looksText ? "txt" : "bin");
        const filename = `${mediaId}.${ext}`;

        log?.(
          `[wecom-agent] file meta: msgType=${msgType} mediaId=${mediaId} size=${buffer.length} maxBytes=${mediaMaxBytes} ` +
            `contentType=${contentType} normalizedContentType=${normalizedContentType} originalFileName=${originalFileName} ` +
            `xmlFileName=${xmlFileName ?? "N/A"} headerFileName=${headerFileName ?? "N/A"} ` +
            `textHeuristic(sample=${heuristic.sampleSize}, bad=${heuristic.badCount}, ratio=${heuristic.badRatio.toFixed(4)}) ` +
            `headHex="${previewHex(buffer)}"`,
        );

        // 使用 Core SDK 保存媒体文件
        const saved = await core.channel.media.saveMediaBuffer(
          buffer,
          normalizedContentType,
          "inbound", // context/scope
          mediaMaxBytes, // limit
          originalFileName,
        );

        log?.(`[wecom-agent] media saved to: ${saved.path}`);
        mediaPath = saved.path;
        mediaType = normalizedContentType;

        // 构建附件
        attachments.push({
          name: originalFileName,
          contentType: normalizedContentType,
          remoteUrl: pathToFileURL(saved.path).href, // 使用跨平台安全的文件 URL
        });

        // 更新文本提示
        if (textPreview) {
          finalContent = [
            content,
            "",
            "文件内容预览：",
            "```",
            textPreview,
            "```",
            `(已下载 ${buffer.length} 字节)`,
          ].join("\n");
        } else {
          if (msgType === "file") {
            finalContent = [
              content,
              "",
              `已收到文件：${originalFileName}`,
              `文件类型：${normalizedContentType || contentType || "未知"}`,
              "提示：当前仅对文本/Markdown/JSON/CSV/HTML/PDF（可选）做内容抽取；其他二进制格式请转为 PDF 或复制文本内容。",
              `(已下载 ${buffer.length} 字节)`,
            ].join("\n");
          } else {
            finalContent = `${content} (已下载 ${buffer.length} 字节)`;
          }
        }
        log?.(
          `[wecom-agent] file preview: enabled=${looksText} finalContentLen=${finalContent.length} attachments=${attachments.length}`,
        );
      } catch (err) {
        error?.(`[wecom-agent] media processing failed: ${String(err)}`);
        auditSink?.({
          transport: "agent-callback",
          category: "runtime-error",
          messageId: extractMsgId(msg) ?? undefined,
          summary: `agent media processing failed mediaId=${mediaId}`,
          raw: {
            transport: "agent-callback",
            envelopeType: "xml",
            body: msg,
          },
          error: err instanceof Error ? err.message : String(err),
        });
        finalContent = [
          content,
          "",
          `媒体处理失败：${String(err)}`,
          `提示：可在 OpenClaw 配置中提高 channels.wecom.mediaMaxMb（当前=${Math.round(mediaMaxBytes / (1024 * 1024))}MB）`,
          "例如：openclaw config set channels.wecom.mediaMaxMb 50",
        ].join("\n");
      }
    } else {
      const keys = Object.keys((msg as unknown as Record<string, unknown>) ?? {})
        .slice(0, 50)
        .join(",");
      error?.(`[wecom-agent] mediaId not found for ${msgType}; keys=${keys}`);
    }
  }

  // 解析路由
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "wecom",
    accountId: agent.accountId,
    peer: { kind: isGroup ? "group" : "direct", id: peerId },
  });

  // ===== 动态 Agent 路由注入 =====
  const useDynamicAgent = shouldUseDynamicAgent({
    chatType: isGroup ? "group" : "dm",
    senderId: fromUser,
    config,
  });

  if (shouldRejectWecomDefaultRoute({ cfg: config, matchedBy: route.matchedBy, useDynamicAgent })) {
    const prompt =
      `当前账号（${agent.accountId}）未绑定 OpenClaw Agent，已拒绝回退到默认主智能体。` +
      `请在 bindings 中添加：{"agentId":"你的Agent","match":{"channel":"wecom","accountId":"${agent.accountId}"}}`;
    error?.(
      `[wecom-agent] routing guard: blocked default fallback accountId=${agent.accountId} matchedBy=${route.matchedBy} from=${fromUser}`,
    );
    try {
      if (upstreamAgent) {
        await sendUpstreamAgentApiText({
          upstreamAgent,
          primaryAgent: primaryAgentForUpstream!,
          ...(upstreamReplyTarget ?? replyTarget),
          text: prompt,
        });
      } else {
        await sendAgentApiText({ agent, ...replyTarget, text: prompt });
      }
      touchTransportSession?.({ lastOutboundAt: Date.now(), running: true });
      log?.(`[wecom-agent] routing guard prompt delivered to ${fromUser}`);
    } catch (err: unknown) {
      error?.(`[wecom-agent] routing guard prompt failed: ${String(err)}`);
      auditSink?.({
        transport: "agent-callback",
        category: "fallback-delivery-failed",
        summary: `routing guard prompt failed user=${fromUser}`,
        raw: {
          transport: "agent-callback",
          envelopeType: "xml",
          body: msg,
        },
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (useDynamicAgent) {
    const targetAgentId = generateAgentId(isGroup ? "group" : "dm", peerId, agent.accountId);
    route.agentId = targetAgentId;
    route.sessionKey = `agent:${targetAgentId}:wecom:${agent.accountId}:${isGroup ? "group" : "dm"}:${peerId}`;
    // 异步添加到 agents.list（不阻塞）
    ensureDynamicAgentListed(targetAgentId, core).catch(() => {});
    log?.(`[wecom-agent] dynamic agent routing: ${targetAgentId}, sessionKey=${route.sessionKey}`);
  }
  // ===== 动态 Agent 路由注入结束 =====

  registerWecomSourceSnapshot({
    accountId: agent.accountId,
    source: "agent-callback",
    messageId: extractMsgId(msg) ?? undefined,
    sessionKey: route.sessionKey,
    peerKind: isGroup ? "group" : "direct",
    peerId,
  });

  // 构建上下文
  const fromLabel = isGroup ? `group:${peerId}` : `user:${fromUser}`;
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
    body: finalContent,
  });

  const authz = await resolveWecomCommandAuthorization({
    core,
    cfg: config,
    // Agent 门禁应读取 channels.wecom.agent.dm（即 agent.config.dm），而不是 channels.wecom.dm（不存在）
    accountConfig: agent.config,
    rawBody: finalContent,
    senderUserId: fromUser,
  });
  log?.(
    `[wecom-agent] authz: dmPolicy=${authz.dmPolicy} shouldCompute=${authz.shouldComputeAuth} sender=${fromUser.toLowerCase()} senderAllowed=${authz.senderAllowed} authorizerConfigured=${authz.authorizerConfigured} commandAuthorized=${String(authz.commandAuthorized)}`,
  );

  // 命令门禁：未授权时必须明确回复（Agent 侧用私信提示）
  if (authz.shouldComputeAuth && authz.commandAuthorized !== true) {
    const prompt = buildWecomUnauthorizedCommandPrompt({
      senderUserId: fromUser,
      dmPolicy: authz.dmPolicy,
      scope: "agent",
    });
    try {
      if (upstreamAgent) {
        await sendUpstreamAgentApiText({
          upstreamAgent,
          primaryAgent: primaryAgentForUpstream!,
          ...(upstreamReplyTarget ?? replyTarget),
          text: prompt,
        });
      } else {
        await sendAgentApiText({ agent, ...replyTarget, text: prompt });
      }
      touchTransportSession?.({ lastOutboundAt: Date.now(), running: true });
      log?.(
        `[wecom-agent] unauthorized command: replied to ${isGroup ? `chat:${peerId}` : fromUser}`,
      );
    } catch (err: unknown) {
      error?.(`[wecom-agent] unauthorized command reply failed: ${String(err)}`);
      auditSink?.({
        transport: "agent-callback",
        category: "fallback-delivery-failed",
        summary: `unauthorized prompt failed user=${fromUser}`,
        raw: {
          transport: "agent-callback",
          envelopeType: "xml",
          body: msg,
        },
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: finalContent,
    CommandBody: finalContent,
    Attachments: attachments.length > 0 ? attachments : undefined,
    From: isGroup ? `wecom:group:${peerId}` : `wecom:user:${fromUser}`,
    To: isGroup ? `wecom:group:${peerId}` : `wecom:user:${fromUser}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: fromUser,
    SenderId: fromUser,
    Provider: "wecom",
    Surface: "webchat",
    OriginatingChannel: "wecom",
    // 标记为 Agent 会话的回复路由目标，避免与 Bot 会话混淆：
    // - 用于让 /new /reset 这类命令回执不被 Bot 侧策略拦截
    // - 群聊场景也统一路由为私信触发者（与 deliver 策略一致）
    OriginatingTo: buildAgentSessionTarget(fromUser, agent.accountId),
    CommandAuthorized: authz.commandAuthorized ?? true,
    MediaPath: mediaPath,
    MediaType: mediaType,
    MediaUrl: mediaPath,
  });
  const sessionId = readContextSessionId(ctxPayload);

  log?.(
    `[wecom-agent] session bound: sessionKey=${ctxPayload.SessionKey ?? route.sessionKey} sessionId=${sessionId ?? "N/A"} peer=${peerId} upstream=${String(Boolean(upstreamAgent))}`,
  );

  registerWecomSourceSnapshot({
    accountId: agent.accountId,
    source: "agent-callback",
    messageId: extractMsgId(msg) ?? undefined,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    sessionId,
    peerKind: isGroup ? "group" : "direct",
    peerId,
    upstreamCorpId: upstreamAgent?.corpId,
  });
  setPeerContext(agent.accountId, peerId, {
    peerKind: isGroup ? "group" : "direct",
    lastSeen: Date.now(),
    upstreamCorpId: upstreamAgent?.corpId,
  });

  // 记录会话
  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err: unknown) => {
      error?.(`[wecom-agent] session record failed: ${String(err)}`);
    },
  });

  // 5秒无响应自动回复进度提示
  let hasResponseSent = false;
  const effectiveAgent = upstreamAgent ?? agent;
  const effectiveReplyTarget = upstreamReplyTarget ?? replyTarget;
  const processingTimer = setTimeout(async () => {
    if (hasResponseSent) return;
    try {
      if (upstreamAgent && primaryAgentForUpstream) {
        await sendUpstreamAgentApiText({
          upstreamAgent,
          primaryAgent: primaryAgentForUpstream,
          ...effectiveReplyTarget,
          text: "正在处理中，请稍候...",
        });
      } else {
        await sendAgentApiText({
          agent: effectiveAgent,
          ...effectiveReplyTarget,
          text: "正在处理中，请稍候...",
        });
      }
      log?.(
        `[wecom-agent] sent processing notification to ${isGroup ? `chat:${peerId}` : fromUser}`,
      );
    } catch (err) {
      error?.(`[wecom-agent] failed to send processing notification: ${String(err)}`);
    }
  }, 5000);

  // 发送队列锁：确保所有 deliver 调用（以及内部的分片发送）严格串行执行
  let messageSendQueue = Promise.resolve();
  let deferredMediaUrls: string[] = [];

  const mergeDeferredMediaUrls = (mediaUrls: string[]): string[] => {
    if (mediaUrls.length === 0) {
      return deferredMediaUrls;
    }
    const merged = [...deferredMediaUrls];
    for (const mediaUrl of mediaUrls) {
      if (!merged.includes(mediaUrl)) {
        merged.push(mediaUrl);
      }
    }
    deferredMediaUrls = merged;
    return deferredMediaUrls;
  };

  const replyWecomTarget = effectiveReplyTarget.chatId
    ? ({ chatid: effectiveReplyTarget.chatId } as const)
    : ({ touser: effectiveReplyTarget.toUser } as const);

  try {
    // 调度回复
    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg: config,
      replyOptions: {
        disableBlockStreaming: false,
      },
      dispatcherOptions: {
        deliver: async (payload: ReplyPayload, info: { kind: string }) => {
          const text = payload.text ?? "";
          const incomingMediaUrls = payload.mediaUrls || (payload.mediaUrl ? [payload.mediaUrl] : []);
          if (info.kind !== "final" && incomingMediaUrls.length > 0) {
            mergeDeferredMediaUrls(incomingMediaUrls);
          }
          const mediaUrls =
            info.kind === "final"
              ? mergeDeferredMediaUrls(incomingMediaUrls)
              : incomingMediaUrls;

          // Agent 回调回复不经过 wecomOutbound，所以要自己解析账号配置，
          // 否则 markdown.format 对这条路径不生效。
          //
          // 群会话不需要特殊处理：appchat/send 有 markdown msgtype（手册 90248）。
          const asMarkdown =
            resolveWecomMarkdownFormat(config, effectiveAgent.accountId) === "markdown";
          const outboundText = text;

          if ((!outboundText || !outboundText.trim()) && mediaUrls.length === 0) {
            return;
          }

          // 纯文本沿用既有的定长切分；markdown 必须先整体转换再按语法边界分片，
          // 否则转换后超限会被截断、`**bold**` 会被从中间劈开。
          // 两条路径都再过一遍字节上限（600 字符的 emoji 可达 2400 字节）。
          const replyChunks = asMarkdown
            ? prepareWecomMarkdownChunks(
                outboundText,
                MESSAGE_BYTE_LIMITS.AGENT_MESSAGE,
                AGENT_REPLY_CHUNK_CHARS,
              )
            : enforceReplyByteLimit(sliceByLength(outboundText, AGENT_REPLY_CHUNK_CHARS));

          // 标记已有回复，清除/失效定时器
          hasResponseSent = true;
          clearTimeout(processingTimer);

          // 将本次发送任务加入队列
          // 即使 deliver 被并发调用，队列中的任务也会按入队顺序串行执行
          const currentTask = async () => {
            // 确保分片顺序发送
            for (let chunkIndex = 0; chunkIndex < replyChunks.length; chunkIndex += 1) {
              const chunk = replyChunks[chunkIndex]!;

              try {
                if (upstreamAgent) {
                  const sendUpstream = asMarkdown
                    ? sendUpstreamAgentApiMarkdown
                    : sendUpstreamAgentApiText;
                  await sendUpstream({
                    upstreamAgent,
                    primaryAgent: primaryAgentForUpstream!,
                    ...effectiveReplyTarget,
                    text: chunk,
                  });
                } else {
                  const send = asMarkdown ? sendAgentApiMarkdown : sendAgentApiText;
                  await send({ agent: effectiveAgent, ...effectiveReplyTarget, text: chunk });
                }
                touchTransportSession?.({ lastOutboundAt: Date.now(), running: true });
                log?.(
                  `[wecom-agent] reply chunk delivered (${info.kind}) to ${isGroup ? `chat:${peerId}` : fromUser}, len=${chunk.length}, sessionKey=${ctxPayload.SessionKey ?? route.sessionKey}, sessionId=${sessionId ?? "N/A"}`,
                );

                // 强制延时：确保企业微信有足够时间处理顺序（优化：200ms → 50ms）
                if (chunkIndex + 1 < replyChunks.length) {
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
              } catch (err: unknown) {
                const message =
                  err instanceof Error
                    ? `${err.message}${err.cause ? ` (cause: ${String(err.cause)})` : ""}`
                    : String(err);
                error?.(`[wecom-agent] reply failed: ${message}`);
                auditSink?.({
                  transport: "agent-callback",
                  category: "fallback-delivery-failed",
                  summary: `agent callback reply failed user=${fromUser} kind=${info.kind}`,
                  raw: {
                    transport: "agent-callback",
                    envelopeType: "xml",
                    body: msg,
                  },
                  error: message,
                });
              }
            }

            if (info.kind === "final") {
              for (const mediaUrl of mediaUrls) {
                try {
                  const media = await resolveOutboundMediaAsset({
                    mediaUrl,
                    network: effectiveAgent.network,
                  });
                  if (upstreamAgent) {
                    await deliverUpstreamAgentApiMedia({
                      upstreamAgent,
                      primaryAgent: primaryAgentForUpstream!,
                      target: replyWecomTarget,
                      buffer: media.buffer,
                      filename: media.filename,
                      contentType: media.contentType,
                    });
                  } else {
                    await deliverAgentApiMedia({
                      agent: effectiveAgent,
                      target: replyWecomTarget,
                      buffer: media.buffer,
                      filename: media.filename,
                      contentType: media.contentType,
                    });
                  }
                  touchTransportSession?.({ lastOutboundAt: Date.now(), running: true });
                  log?.(
                    `[wecom-agent] reply media delivered (${info.kind}) to ${isGroup ? `chat:${peerId}` : fromUser}, media=${media.filename}, sessionKey=${ctxPayload.SessionKey ?? route.sessionKey}, sessionId=${sessionId ?? "N/A"}`,
                  );
                } catch (err: unknown) {
                  const message =
                    err instanceof Error
                      ? `${err.message}${err.cause ? ` (cause: ${String(err.cause)})` : ""}`
                      : String(err);
                  error?.(`[wecom-agent] media reply failed: ${message}`);
                  auditSink?.({
                    transport: "agent-callback",
                    category: "fallback-delivery-failed",
                    summary: `agent callback media reply failed user=${fromUser} kind=${info.kind}`,
                    raw: {
                      transport: "agent-callback",
                      envelopeType: "xml",
                      body: msg,
                    },
                    error: message,
                  });
                }
              }
              deferredMediaUrls = [];
            }

            // 不同 Block 之间也增加一点间隔（优化：200ms → 50ms）
            if (info.kind !== "final") {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
          };

          // 更新队列链
          // 使用 then 链接，并捕获前一个任务可能的错误，确保当前任务总能执行
          messageSendQueue = messageSendQueue
            .then(() => currentTask())
            .catch((err) => {
              error?.(`[wecom-agent] previous send task failed: ${String(err)}`);
              // 前一个失败不应阻止当前任务，继续尝试执行当前任务
              return currentTask();
            });

          // 等待当前任务完成（保持背压，虽然对于 http callback 模式这可能只是延迟了整体结束时间）
          await messageSendQueue;
        },
        onError: (err: unknown, info: { kind: string }) => {
          clearTimeout(processingTimer);
          error?.(`[wecom-agent] ${info.kind} reply error: ${String(err)}`);
        },
      },
    });
  } finally {
    clearTimeout(processingTimer);
    // 确保所有排队的消息都发完了才退出（虽然对于 HTTP 响应来说，res.end 早就调用了）
    await messageSendQueue;
  }
}

/**
 * **handleAgentWebhook (Agent Webhook 入口)**
 *
 * 统一处理 Agent 模式的 POST 消息回调请求。
 * URL 验证与验签/解密由 monitor 层统一处理后再调用本函数。
 */
export async function handleAgentWebhook(params: AgentWebhookParams): Promise<boolean> {
  const { req } = params;

  if (req.method === "POST") {
    return handleMessageCallback(params);
  }

  return false;
}
