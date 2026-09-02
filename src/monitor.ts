/**
 * 企业微信 WebSocket 监控器主模块
 *
 * 负责：
 * - 建立和管理 WebSocket 连接
 * - 协调消息处理流程（解析→策略检查→下载图片→路由回复）
 * - 资源生命周期管理
 *
 * 子模块：
 * - message-parser.ts  : 消息内容解析
 * - message-sender.ts  : 消息发送（带超时保护）
 * - media-handler.ts   : 图片下载和保存（带超时保护）
 * - group-policy.ts    : 群组访问控制
 * - dm-policy.ts       : 私聊访问控制
 * - state-manager.ts   : 全局状态管理（带 TTL 清理）
 * - timeout.ts         : 超时工具
 */

import * as os from "os";
import * as path from "path";
import {
  WSClient,
  generateReqId,
  WSAuthFailureError,
  WSReconnectExhaustedError,
} from "@wecom/aibot-node-sdk";
import type { WsFrame, Logger } from "@wecom/aibot-node-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import {
  CHANNEL_ID,
  THINKING_MESSAGE,
  MEDIA_IMAGE_PLACEHOLDER,
  MEDIA_DOCUMENT_PLACEHOLDER,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_MAX_RECONNECT_ATTEMPTS,
  WS_MAX_AUTH_FAILURE_ATTEMPTS,
  EVENT_ENTER_CHECK_UPDATE,
  CMD_ENTER_EVENT_REPLY,
  SCENE_WECOM_OPENCLAW,
} from "./const.js";
import { checkDmPolicy } from "./dm-policy.js";
import { processDynamicRouting } from "./dynamic-routing.js";
import { checkGroupPolicy } from "./group-policy.js";
import type { WeComMonitorOptions, MessageState } from "./interface.js";
import {
  downloadAndSaveImages,
  downloadAndSaveFiles,
  MediaOversizeError,
} from "./media-handler.js";
import { uploadAndSendMedia } from "./media-uploader.js";
import { parseMessageContent, type MessageBody } from "./message-parser.js";
import { sendWeComReply, sendWeComReplyNonBlocking, StreamExpiredError } from "./message-sender.js";
import { enqueueWeComChatTask } from "./chat-queue.js";
import { getDefaultMediaLocalRoots, resolveStateDir } from "./openclaw-compat.js";
import { getWeComRuntime } from "./runtime.js";
import {
  setWeComWebSocket,
  setMessageState,
  deleteMessageState,
  setReqIdForChat,
  warmupReqIdStore,
  startMessageStateCleanup,
  stopMessageStateCleanup,
  cleanupAccount,
} from "./state-manager.js";
import {
  updateTemplateCardOnEvent,
  processTemplateCardsIfNeeded,
} from "./template-card-manager.js";
import { maskTemplateCardBlocks } from "./template-card-parser.js";
import type { ResolvedWeComAccount, WeComConfig } from "./utils.js";
import { PLUGIN_VERSION } from "./version.js";
import {
  diagnosticEndpoint,
  diagnosticFingerprint,
  formatDiagnosticError,
  sanitizeSdkLog,
  utf8Bytes,
  wecomFlowId,
} from "./diagnostics.js";

// ============================================================================
// 消息条目类型
// ============================================================================

/**
 * 消息条目：存储解析阶段（Step 1-4）的结果，
 * 传入串行队列后由处理阶段（Step 5-7）消费。
 */
interface WeComMessageEntry {
  frame: WsFrame;
  account: ResolvedWeComAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  wsClient: WSClient;
  /** 解析后的文本内容 */
  text: string;
  /** 下载后的媒体文件列表 */
  mediaList: Array<{ path: string; contentType?: string }>;
  /** 引用消息内容 */
  quoteContent?: string;
  /** 消息 ID */
  messageId: string;
  /** chatId（群组 ID 或用户 ID） */
  chatId: string;
  /** 请求 ID */
  reqId: string;
  /** 脱敏链路 ID；不包含原始 reqId、msgId、chatId 或 senderId。 */
  traceId: string;
  receivedAt: number;
}

// ============================================================================
// 附件超限提示文案
// ============================================================================

/**
 * 构造「附件超过 OpenClaw 大小限制」的中文提示文案。
 */
function buildMediaOversizeHintText(err: MediaOversizeError): string {
  const maxMb = err.maxBytes / 1024 / 1024;
  return `当前OpenClaw限制文件不超过${maxMb}MB，请修改OpenClaw配置。`;
}

// ============================================================================
// 媒体本地路径白名单扩展
// ============================================================================

/**
 * 在 getDefaultMediaLocalRoots() 基础上，将 stateDir 本身也加入白名单，
 * 并合并用户在 WeComConfig 中配置的自定义 mediaLocalRoots。
 *
 * getDefaultMediaLocalRoots() 仅包含 stateDir 下的子目录（media/agents/workspace/sandboxes），
 * 但 agent 生成的文件可能直接放在 stateDir 根目录下（如 ~/.openclaw-dev/1.png），
 * 因此需要将 stateDir 本身也加入白名单以避免 LocalMediaAccessError。
 *
 * 用户可在 openclaw.json 中配置：
 * {
 *   "channels": {
 *     "wecom": {
 *       "mediaLocalRoots": ["~/Downloads", "~/Documents"]
 *     }
 *   }
 * }
 */
async function getExtendedMediaLocalRoots(config?: WeComConfig): Promise<string[]> {
  // 从兼容层获取默认白名单（内部已处理低版本 SDK 的 fallback）
  const defaults = await getDefaultMediaLocalRoots();
  const roots: string[] = [...defaults];

  const stateDir = path.resolve(resolveStateDir());
  if (!roots.includes(stateDir)) {
    roots.push(stateDir);
  }
  // 合并用户在 WeComConfig 中配置的自定义路径
  if (config?.mediaLocalRoots) {
    for (const r of config.mediaLocalRoots) {
      const resolved = path.resolve(r.replace(/^~(?=\/|$)/, os.homedir()));
      if (!roots.includes(resolved)) {
        roots.push(resolved);
      }
    }
  }
  return roots;
}

// ============================================================================
// 媒体发送错误提示
// ============================================================================

/**
 * 根据媒体发送结果生成纯文本错误摘要（用于替换 thinking 流式消息展示给用户）。
 *
 * 使用纯文本而非 markdown 格式，因为 replyStream 只支持纯文本。
 */
function buildMediaErrorSummary(
  mediaUrl: string,
  result: { rejectReason?: string; error?: string },
): string {
  if (result.error?.includes("LocalMediaAccessError")) {
    return `⚠️ 文件发送失败：没有权限访问路径 ${mediaUrl}\n请在 openclaw.json 的 mediaLocalRoots 中添加该路径的父目录后重启生效。`;
  }
  if (result.rejectReason) {
    return `⚠️ 文件发送失败：${result.rejectReason}`;
  }
  return `⚠️ 文件发送失败：无法处理文件 ${mediaUrl}，请稍后再试。`;
}

// ============================================================================
// 重新导出（保持向后兼容）
// ============================================================================

export type { WeComMonitorOptions } from "./interface.js";
export { WeComCommand } from "./const.js";
export {
  getWeComWebSocket,
  setReqIdForChat,
  getReqIdForChatAsync,
  getReqIdForChat,
  deleteReqIdForChat,
  warmupReqIdStore,
  flushReqIdStore,
} from "./state-manager.js";
export { sendWeComReply } from "./message-sender.js";

// ============================================================================
// 消息上下文构建
// ============================================================================

/**
 * 构建消息上下文
 * @returns 消息上下文对象
 */
function buildMessageContext(
  frame: WsFrame,
  account: ResolvedWeComAccount,
  config: OpenClawConfig,
  text: string,
  mediaList: Array<{ path: string; contentType?: string }>,
  quoteContent?: string,
  runtime?: RuntimeEnv,
) {
  const core = getWeComRuntime();
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const chatType = body.chattype === "group" ? "group" : "direct";

  // 解析路由信息
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: chatType,
      id: chatId,
    },
  });

  // ===== 动态 Agent 路由注入 =====
  const routingResult = processDynamicRouting({
    route,
    config,
    core,
    accountId: account.accountId,
    chatType: chatType === "group" ? "group" : "dm",
    chatId,
    senderId: body.from.userid,
    log: runtime?.log ? (...args: any[]) => runtime.log?.(...args) : undefined,
    error: runtime?.error ? (...args: any[]) => runtime.error?.(...args) : undefined,
  });

  // 应用动态路由结果
  if (routingResult.routeModified) {
    route.agentId = routingResult.finalAgentId;
    route.sessionKey = routingResult.finalSessionKey;
  }
  // ===== 动态 Agent 路由注入结束 =====

  // 构建会话标签
  const fromLabel = chatType === "group" ? `group:${chatId}` : `user:${body.from.userid}`;

  // 当只有媒体没有文本时，使用占位符标识媒体类型
  const hasImages = mediaList.some((m) => m.contentType?.startsWith("image/"));
  const messageBody =
    text ||
    (mediaList.length > 0
      ? hasImages
        ? MEDIA_IMAGE_PLACEHOLDER
        : MEDIA_DOCUMENT_PLACEHOLDER
      : "");

  // 构建多媒体数组
  const mediaPaths = mediaList.length > 0 ? mediaList.map((m) => m.path) : undefined;
  const mediaTypes =
    mediaList.length > 0
      ? (mediaList.map((m) => m.contentType).filter(Boolean) as string[])
      : undefined;

  // 使用 route.agentId 解析 storePath（多 agent 场景下 session 路径隔离）
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });

  // 构建标准消息上下文
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: messageBody,
    RawBody: messageBody,
    CommandBody: messageBody,

    MessageSid: body.msgid,

    From:
      chatType === "group" ? `${CHANNEL_ID}:group:${chatId}` : `${CHANNEL_ID}:${body.from.userid}`,
    To: `${CHANNEL_ID}:${chatId}`,
    SenderId: body.from.userid,

    SessionKey: route.sessionKey,
    AccountId: route.accountId,

    ChatType: chatType,
    ConversationLabel: fromLabel,

    Timestamp: Date.now(),

    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,

    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `${CHANNEL_ID}:${chatId}`,

    CommandAuthorized: true,

    ResponseUrl: body.response_url,
    ReqId: frame.headers.req_id,
    WeComFrame: frame,

    MediaPath: mediaList[0]?.path,
    MediaType: mediaList[0]?.contentType,
    MediaPaths: mediaPaths,
    MediaTypes: mediaTypes,
    MediaUrls: mediaPaths,

    ReplyToBody: quoteContent,
  });

  return { ctxPayload, route, storePath, chatId, chatType };
}

// ============================================================================
// 消息处理和回复
// ============================================================================

/** deliver 回调所需的上下文 */
interface DeliverContext {
  wsClient: WSClient;
  frame: WsFrame;
  state: MessageState;
  account: ResolvedWeComAccount;
  runtime: RuntimeEnv;
}

/**
 * 发送"思考中"消息
 */
async function sendThinkingReply(params: {
  wsClient: WSClient;
  frame: WsFrame;
  streamId: string;
  runtime: RuntimeEnv;
  state?: MessageState;
  accountId: string;
}): Promise<void> {
  const { wsClient, frame, streamId, runtime, state, accountId } = params;
  try {
    await sendWeComReply({
      wsClient,
      frame,
      text: THINKING_MESSAGE,
      runtime,
      finish: false,
      streamId,
      accountId,
      traceId: state?.traceId,
    });
  } catch (err) {
    if (err instanceof StreamExpiredError && state) {
      state.streamExpired = true;
      runtime.log?.(
        `[wecom][flow] trace=${state.traceId ?? "none"} stage=stream_expired account=${accountId} phase=thinking fallback=active_send`,
      );
    } else {
      runtime.error?.(
        `[wecom][flow] trace=${state?.traceId ?? "none"} stage=thinking_failed account=${accountId} ${formatDiagnosticError(err)}`,
      );
    }
  }
}

/**
 * 上传并发送一批媒体文件（统一走主动发送通道）
 *
 * replyMedia（被动回复）无法覆盖 replyStream 发出的 thinking 流式消息，
 * 因此所有媒体统一走 aibot_send_msg 主动发送。
 */
async function sendMediaBatch(ctx: DeliverContext, mediaUrls: string[]): Promise<void> {
  const { wsClient, frame, state, account, runtime } = ctx;
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const mediaLocalRoots = await getExtendedMediaLocalRoots(account.config);

  runtime.log?.(
    `[wecom][flow] trace=${state.traceId ?? "none"} stage=media_batch_start mediaCount=${mediaUrls.length} allowedRootCount=${mediaLocalRoots.length}`,
  );

  for (const mediaUrl of mediaUrls) {
    const result = await uploadAndSendMedia({
      wsClient,
      mediaUrl,
      chatId,
      mediaLocalRoots,
      log: (...args: any[]) => runtime.log?.(...args),
      errorLog: (...args: any[]) => runtime.error?.(...args),
    });

    if (result.ok) {
      state.hasMedia = true;
    } else {
      state.hasMediaFailed = true;
      runtime.error?.(
        `[wecom][flow] trace=${state.traceId ?? "none"} stage=media_failed account=${account.accountId} media=${diagnosticFingerprint(mediaUrl)} reason=${result.rejectReason || result.error}`,
      );
      // 收集错误摘要，后续在 finishThinkingStream 中直接替换 thinking 流展示给用户
      const summary = buildMediaErrorSummary(mediaUrl, result);
      state.mediaErrorSummary = state.mediaErrorSummary
        ? `${state.mediaErrorSummary}\n\n${summary}`
        : summary;
    }
  }
}

/**
 * 关闭 thinking 流（发送 finish=true 的流式消息）
 *
 * thinking 是通过 replyStream 用 streamId 发的流式消息，
 * 只有同一 streamId 的 replyStream(finish=true) 才能关闭它。
 *
 * ⚠️ 注意：企微会忽略空格等不可见内容，必须用有可见字符的文案才能真正
 *    替换掉 thinking 动画，否则 thinking 会一直残留。
 *
 * 关闭策略（按优先级）：
 * 1. 有可见文本 → 用完整文本关闭
 * 2. 有模板卡片发送成功 → "📋 卡片消息已发送。"
 * 3. 有媒体成功发送（通过 deliver 回调） → 用友好提示"文件已发送"
 * 4. 媒体发送失败 → 直接用错误摘要替换 thinking
 *
 * 降级策略：
 * - 当 streamExpired=true（errcode 846608）时，流式通道已不可用（>6分钟），
 *   改用 wsClient.sendMessage 主动发送完整文本。
 *
 * 注意：模板卡片的检测和发送已在 finishThinkingStream 之前由
 *       processTemplateCardsIfNeeded 完成，此处只关心最后的消息发送。
 */
async function finishThinkingStream(ctx: DeliverContext): Promise<void> {
  const { wsClient, frame, state, account, runtime } = ctx;
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const visibleText = state.accumulatedText;

  let finishText: string = state.accumulatedText;
  if (visibleText) {
    finishText = state.accumulatedText;
  } else if (state.hasTemplateCard) {
    finishText = "📋 卡片消息已发送。";
  } else if (state.hasMedia) {
    if (state.hasMediaFailed && state.mediaErrorSummary) {
      finishText = finishText
        ? `${finishText}\n\n${state.mediaErrorSummary}`
        : state.mediaErrorSummary;
    } else if (!finishText) {
      finishText = "📎 文件已发送，请查收。";
    }
  }

  // 兜底：本轮无任何可见产出（无文本/媒体/卡片，常见于"只发文件未带指令"
  // 的消息被 agent 当作上下文读取后不单独回复）。此时若已开启过 thinking 流，
  // 必须发送一个含可见字符的 finish 帧关闭它，否则该消息会一直 loading。
  // 注意：企微会忽略纯空格等不可见内容，必须用可见字符才能真正关闭。
  if (!finishText && state.streamId) {
    finishText = "✅ 已收到";
  }

  if (finishText) {
    // 尝试流式发送；若已知过期或发送时发现过期，统一降级为主动发送
    let expired = state.streamExpired;
    if (!expired) {
      try {
        await sendWeComReply({
          wsClient,
          frame,
          text: finishText,
          runtime,
          finish: true,
          streamId: state.streamId,
          accountId: account.accountId,
          traceId: state.traceId,
        });
      } catch (err) {
        if (err instanceof StreamExpiredError) {
          expired = true;
        } else {
          throw err;
        }
      }
    }
    if (expired) {
      const startedAt = Date.now();
      runtime.log?.(
        `[wecom][flow] trace=${state.traceId ?? "none"} stage=outbound_start account=${account.accountId} transport=active_send reason=stream_expired textBytes=${utf8Bytes(finishText)}`,
      );
      await wsClient.sendMessage(chatId, {
        msgtype: "markdown",
        markdown: { content: finishText },
      });
      runtime.log?.(
        `[wecom][flow] trace=${state.traceId ?? "none"} stage=outbound_delivered account=${account.accountId} transport=active_send reason=stream_expired durationMs=${Date.now() - startedAt}`,
      );
    }
  }
}

/**
 * 路由消息到核心处理流程并处理回复
 */
async function routeAndDispatchMessage(params: {
  ctxPayload: ReturnType<typeof buildMessageContext>["ctxPayload"];
  route: ReturnType<typeof buildMessageContext>["route"];
  storePath: string;
  chatId: string;
  chatType: string;
  config: OpenClawConfig;
  account: ResolvedWeComAccount;
  wsClient: WSClient;
  frame: WsFrame;
  state: MessageState;
  runtime: RuntimeEnv;
  onCleanup: () => void;
}): Promise<void> {
  const {
    ctxPayload,
    route,
    storePath,
    chatId,
    chatType,
    config,
    account,
    wsClient,
    frame,
    state,
    runtime,
    onCleanup,
  } = params;
  const core = getWeComRuntime();
  const ctx: DeliverContext = { wsClient, frame, state, account, runtime };
  const traceId = state.traceId ?? "none";

  // 防止 onCleanup 被多次调用（onError 回调与 catch 块可能重复触发）
  let cleanedUp = false;
  const safeCleanup = () => {
    if (!cleanedUp) {
      cleanedUp = true;
      onCleanup();
    }
  };

  let isShowThink = !(account.sendThinkingMessage ?? true);

  try {
    const sessionStartedAt = Date.now();
    runtime.log?.(
      `[wecom][flow] trace=${traceId} stage=session_record_start account=${account.accountId} agent=${route.agentId} session=${diagnosticFingerprint(route.sessionKey)}`,
    );
    // 记录 inbound session 元数据（session 追踪）
    await core.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      updateLastRoute:
        chatType !== "group"
          ? {
              sessionKey: route.mainSessionKey,
              channel: CHANNEL_ID,
              to: `${CHANNEL_ID}:${chatId}`,
              accountId: route.accountId,
            }
          : undefined,
      onRecordError: (err) => {
        runtime.error?.(
          `[wecom][flow] trace=${traceId} stage=session_record_failed account=${account.accountId} ${formatDiagnosticError(err)}`,
        );
      },
    });
    runtime.log?.(
      `[wecom][flow] trace=${traceId} stage=session_recorded durationMs=${Date.now() - sessionStartedAt}`,
    );

    const dispatchStartedAt = Date.now();
    runtime.log?.(
      `[wecom][flow] trace=${traceId} stage=agent_dispatch_start agent=${route.agentId} chatType=${chatType}`,
    );
    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg: config,
      replyOptions: {
        // 打印 LLM 返回的原始分片内容（在 openclaw 核心对 MEDIA: 指令解析之前），
        // 用于排查流式分片导致 MEDIA 指令被切断、识别丢失等问题
        // onPartialReply: (payload: unknown) => {
        // runtime.log?.(`[openclaw -> plugin][partial] payload=${JSON.stringify(payload)}`);
        // },
      },
      dispatcherOptions: {
        onReplyStart: async () => {
          runtime.log?.(`[wecom][flow] trace=${traceId} stage=agent_reply_start`);
          if (!isShowThink && state.streamId && !state.accumulatedText) {
            try {
              await sendThinkingReply({
                wsClient,
                frame,
                streamId: state.streamId,
                runtime,
                state,
                accountId: account.accountId,
              });
            } catch (e) {
              runtime.error?.(
                `[wecom][flow] trace=${traceId} stage=thinking_failed account=${account.accountId} ${formatDiagnosticError(e)}`,
              );
            }
            isShowThink = true;
          }
        },
        deliver: async (payload, info) => {
          const mediaCount = payload.mediaUrls?.length ?? (payload.mediaUrl ? 1 : 0);
          runtime.log?.(
            `[wecom][flow] trace=${traceId} stage=agent_reply_chunk kind=${info.kind} textBytes=${utf8Bytes(payload.text)} mediaCount=${mediaCount}`,
          );

          // 累积文本
          if (payload.text) {
            state.accumulatedText += `${payload.text || ""}`;
          }

          // 发送媒体（统一走主动发送）
          const mediaUrls = payload.mediaUrls?.length
            ? payload.mediaUrls
            : payload.mediaUrl
              ? [payload.mediaUrl]
              : [];
          if (mediaUrls.length > 0) {
            try {
              await sendMediaBatch(ctx, mediaUrls);
            } catch (mediaErr) {
              // sendMediaBatch 内部异常（如 getDefaultMediaLocalRoots 不可用等）
              // 必须标记 state，否则 finishThinkingStream 会显示"处理完成"误导用户
              state.hasMediaFailed = true;
              const errMsg = String(mediaErr);
              const summary = `⚠️ 文件发送失败：内部处理异常，请升级 openclaw 到最新版本后重试。\n错误详情：${errMsg}`;
              state.mediaErrorSummary = state.mediaErrorSummary
                ? `${state.mediaErrorSummary}\n\n${summary}`
                : summary;
              runtime.error?.(
                `[wecom][flow] trace=${traceId} stage=media_batch_failed account=${account.accountId} ${formatDiagnosticError(mediaErr)}`,
              );
            }
          }

          // 中间帧：有可见文本时流式更新（流式过期后跳过，等 deliver 完成后主动发送）
          // 使用 maskTemplateCardBlocks 遮罩正在构建中的模板卡片代码块，
          // 避免 JSON 源码在流式输出过程中暴露给终端用户
          if (state.accumulatedText && !state.streamExpired) {
            try {
              const displayText = maskTemplateCardBlocks(state.accumulatedText, (...args: any[]) =>
                runtime.log?.(...args),
              );
              // if (displayText !== state.accumulatedText) {
              //   runtime.log?.(`[wecom][template-card] Mid-frame masked: original=${state.accumulatedText.length}chars, masked=${displayText.length}chars`);
              // }
              await sendWeComReply({
                wsClient,
                frame,
                text: displayText,
                runtime,
                finish: false,
                streamId: state.streamId,
                accountId: account.accountId,
                traceId,
              });
            } catch (err) {
              if (err instanceof StreamExpiredError) {
                state.streamExpired = true;
                runtime.log?.(
                  `[wecom][flow] trace=${traceId} stage=stream_expired account=${account.accountId} phase=partial fallback=active_send`,
                );
              } else {
                throw err;
              }
            }
          }
        },
        onError: (err, info) => {
          runtime.error?.(
            `[wecom][flow] trace=${traceId} stage=agent_reply_failed account=${account.accountId} kind=${info.kind} ${formatDiagnosticError(err)}`,
          );
        },
      },
    });
    runtime.log?.(
      `[wecom][flow] trace=${traceId} stage=agent_dispatch_complete durationMs=${Date.now() - dispatchStartedAt} textBytes=${utf8Bytes(state.accumulatedText)} hasMedia=${Boolean(state.hasMedia)} hasMediaFailed=${Boolean(state.hasMediaFailed)}`,
    );

    // 模板卡片检测与发送（在关闭 thinking 流之前独立处理）
    const cardResult = await processTemplateCardsIfNeeded({
      wsClient,
      frame,
      state,
      account,
      runtime,
    });
    if (cardResult) {
      // 卡片已发送，用剩余文本替换累积文本
      state.accumulatedText = cardResult.remainingText;
    }

    // 关闭 thinking 流
    await finishThinkingStream(ctx);
    runtime.log?.(
      `[wecom][flow] trace=${traceId} stage=message_complete durationMs=${Date.now() - (state.receivedAt ?? Date.now())} textBytes=${utf8Bytes(state.accumulatedText)} hasMedia=${Boolean(state.hasMedia)} hasTemplateCard=${Boolean(state.hasTemplateCard)}`,
    );
    safeCleanup();
  } catch (err) {
    runtime.error?.(
      `[wecom][flow] trace=${traceId} stage=message_failed account=${account.accountId} durationMs=${Date.now() - (state.receivedAt ?? Date.now())} ${formatDiagnosticError(err)}`,
    );
    // 即使 dispatch 抛异常，也需要处理卡片和关闭 thinking 流
    try {
      const cardResult = await processTemplateCardsIfNeeded({
        wsClient,
        frame,
        state,
        account,
        runtime,
      });
      if (cardResult) {
        state.accumulatedText = cardResult.remainingText;
      }
      await finishThinkingStream(ctx);
    } catch (finishErr) {
      runtime.error?.(
        `[wecom][flow] trace=${traceId} stage=finish_after_failure_failed account=${account.accountId} ${formatDiagnosticError(finishErr)}`,
      );
    }
    safeCleanup();
  }
}

/**
 * 解析并校验企业微信消息（防抖前阶段：Step 1-4）
 *
 * 执行消息解析、策略检查、媒体下载等前置操作，
 * 返回一个可用于防抖缓冲的 entry，或 null（消息被过滤/跳过时）。
 */
async function prepareWeComMessage(params: {
  frame: WsFrame;
  account: ResolvedWeComAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  wsClient: WSClient;
}): Promise<WeComMessageEntry | null> {
  const { frame, account, config, runtime, wsClient } = params;
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const chatType = body.chattype === "group" ? "group" : "direct";
  const messageId = body.msgid;
  const reqId = frame.headers.req_id;
  const receivedAt = Date.now();
  const traceId = wecomFlowId({ accountId: account.accountId, reqId, messageId });

  runtime.log?.(
    `[wecom][flow] trace=${traceId} stage=inbound_received account=${account.accountId} cmd=${frame.cmd ?? "unknown"} type=${body.msgtype ?? "unknown"} chatType=${chatType} req=${diagnosticFingerprint(reqId)} message=${diagnosticFingerprint(messageId)} sender=${diagnosticFingerprint(body.from?.userid)} chat=${diagnosticFingerprint(chatId)}`,
  );

  // Step 1: 解析消息内容
  const { textParts, imageUrls, imageAesKeys, fileUrls, fileAesKeys, quoteContent } =
    parseMessageContent(body);
  let text = textParts.join("\n").trim();
  runtime.log?.(
    `[wecom][flow] trace=${traceId} stage=inbound_parsed textBytes=${utf8Bytes(text)} imageCount=${imageUrls.length} fileCount=${fileUrls.length} hasQuote=${Boolean(quoteContent)}`,
  );

  // // 群聊中移除 @机器人 的提及标记
  // if (body.chattype === "group") {
  //   text = text.replace(/@\S+/g, "").trim();
  // }

  // 如果文本为空但存在引用消息，使用引用消息内容
  if (!text && quoteContent) {
    text = quoteContent;
    runtime.log?.(
      `[wecom][flow] trace=${traceId} stage=quote_promoted account=${account.accountId} reason=empty_direct_text`,
    );
  }

  // 如果既没有文本也没有图片也没有文件也没有引用内容，则跳过
  if (!text && imageUrls.length === 0 && fileUrls.length === 0) {
    runtime.log?.(`[wecom][flow] trace=${traceId} stage=inbound_dropped reason=empty_message`);
    return null;
  }

  // Step 2: 群组策略检查（仅群聊）
  if (chatType === "group") {
    const groupPolicyResult = checkGroupPolicy({
      chatId,
      senderId: body.from.userid,
      account,
      config,
      runtime,
    });

    if (!groupPolicyResult.allowed) {
      runtime.log?.(`[wecom][flow] trace=${traceId} stage=inbound_dropped reason=group_policy`);
      return null;
    }
  }

  // Step 3: DM Policy 访问控制检查（仅私聊）
  const dmPolicyResult = await checkDmPolicy({
    senderId: body.from.userid,
    isGroup: chatType === "group",
    account,
    wsClient,
    frame,
    runtime,
  });

  if (!dmPolicyResult.allowed) {
    runtime.log?.(
      `[wecom][flow] trace=${traceId} stage=inbound_dropped reason=dm_policy pairingSent=${Boolean(dmPolicyResult.pairingSent)}`,
    );
    return null;
  }
  runtime.log?.(`[wecom][flow] trace=${traceId} stage=policy_allowed`);

  // Step 4: 下载并保存图片和文件
  let imageMediaList: Array<{ path: string; contentType?: string }>;
  let fileMediaList: Array<{ path: string; contentType?: string }>;
  try {
    [imageMediaList, fileMediaList] = await Promise.all([
      downloadAndSaveImages({
        imageUrls,
        imageAesKeys,
        account,
        config,
        runtime,
        wsClient,
        traceId,
      }),
      downloadAndSaveFiles({
        fileUrls,
        fileAesKeys,
        account,
        config,
        runtime,
        wsClient,
        traceId,
      }),
    ]);
  } catch (err) {
    if (err instanceof MediaOversizeError) {
      // 附件超过 OpenClaw 配置的大小上限：向用户发送明确的中文提示并终止本次消息处理。
      const hintText = buildMediaOversizeHintText(err);
      runtime.error?.(
        `[wecom][media] trace=${traceId} account=${account.accountId} stage=rejected reason=oversize kind=${err.kind} bytes=${err.sizeBytes} maxBytes=${err.maxBytes} filename=${diagnosticFingerprint(err.filename)}`,
      );
      try {
        await sendWeComReply({
          wsClient,
          frame,
          text: hintText,
          runtime,
          finish: true,
          accountId: account.accountId,
          traceId,
        });
      } catch (replyErr) {
        runtime.error?.(
          `[wecom][media] trace=${traceId} account=${account.accountId} stage=oversize_hint_failed ${formatDiagnosticError(replyErr)}`,
        );
      }
      return null;
    }
    throw err;
  }
  const mediaList = [...imageMediaList, ...fileMediaList];
  runtime.log?.(
    `[wecom][flow] trace=${traceId} stage=media_prepared mediaCount=${mediaList.length} durationMs=${Date.now() - receivedAt}`,
  );

  return {
    frame,
    account,
    config,
    runtime,
    wsClient,
    text,
    mediaList,
    quoteContent,
    messageId,
    chatId,
    reqId,
    traceId,
    receivedAt,
  };
}

/**
 * 处理企业微信消息（Step 5-7）
 *
 * 接收解析后的消息数据，执行初始化状态、发送 thinking、路由到核心。
 * 同一会话中的消息通过串行队列保证按序执行。
 */
async function processWeComMessageNow(entry: WeComMessageEntry): Promise<void> {
  const {
    frame,
    account,
    config,
    runtime,
    wsClient,
    text,
    mediaList,
    quoteContent,
    messageId,
    chatId,
    reqId,
    traceId,
    receivedAt,
  } = entry;

  // Step 5: 初始化消息状态
  setReqIdForChat(chatId, reqId, account.accountId);

  const streamId = generateReqId("stream");
  const state: MessageState = { accumulatedText: "", streamId, traceId, receivedAt };
  setMessageState(messageId, state);

  const cleanupState = () => {
    deleteMessageState(messageId);
  };

  // // Step 6: 发送"思考中"消息
  // const shouldSendThinking = account.sendThinkingMessage ?? true;
  // if (shouldSendThinking) {
  //   await sendThinkingReply({ wsClient, frame, streamId, runtime });
  // }

  // Step 7: 构建上下文并路由到核心处理流程（带整体超时保护）
  const {
    ctxPayload,
    route,
    storePath,
    chatId: resolvedChatId,
    chatType,
  } = buildMessageContext(frame, account, config, text, mediaList, quoteContent, runtime);

  runtime.log?.(
    `[wecom][flow] trace=${traceId} stage=route_resolved account=${route.accountId} agent=${route.agentId} matchedBy=${route.matchedBy} chatType=${chatType} chat=${diagnosticFingerprint(resolvedChatId)} session=${diagnosticFingerprint(route.sessionKey)}`,
  );

  // runtime.log?.(`[plugin -> openclaw] body=${text}, mediaPaths=${JSON.stringify(mediaList.map(m => m.path))}${quoteContent ? `, quote=${quoteContent}` : ''}`);

  try {
    await routeAndDispatchMessage({
      ctxPayload,
      route,
      storePath,
      chatId: resolvedChatId,
      chatType,
      config,
      account,
      wsClient,
      frame,
      state,
      runtime,
      onCleanup: cleanupState,
    });
  } catch (err) {
    runtime.error?.(
      `[wecom][flow] trace=${traceId} stage=message_failed account=${account.accountId} durationMs=${Date.now() - receivedAt} ${formatDiagnosticError(err)}`,
    );
    cleanupState();
  }
}

// ============================================================================
// 创建 SDK Logger 适配器
// ============================================================================

/**
 * 创建适配 RuntimeEnv 的 Logger
 */
function createSdkLogger(runtime: RuntimeEnv, accountId: string): Logger {
  const write = (level: "log" | "error", message: string) => {
    runtime[level]?.(`[${accountId}] [sdk] ${sanitizeSdkLog(message)}`);
  };
  return {
    debug: (message: string) => {
      write("log", message);
    },
    info: (message: string) => {
      write("log", message);
    },
    warn: (message: string) => {
      write("log", `WARN: ${message}`);
    },
    error: (message: string) => {
      write("error", message);
    },
  };
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 监听企业微信 WebSocket 连接
 * 使用 aibot-node-sdk 简化连接管理
 */
export async function monitorWeComProvider(options: WeComMonitorOptions): Promise<void> {
  const { account, config, runtime, abortSignal, setStatus } = options;
  const lifecycleStartedAt = Date.now();

  runtime.log?.(
    `[wecom][lifecycle] account=${account.accountId} stage=client_create pluginVersion=${PLUGIN_VERSION} endpoint=${diagnosticEndpoint(account.websocketUrl)} bot=${diagnosticFingerprint(account.botId)} heartbeatMs=${WS_HEARTBEAT_INTERVAL_MS} maxReconnectAttempts=${WS_MAX_RECONNECT_ATTEMPTS} maxAuthFailureAttempts=${WS_MAX_AUTH_FAILURE_ATTEMPTS}`,
  );

  // 启动消息状态定期清理
  startMessageStateCleanup();

  return new Promise((resolve, reject) => {
    const logger = createSdkLogger(runtime, account.accountId);

    setStatus?.({
      accountId: account.accountId,
      running: true,
      connected: false,
      lifecycle: "starting",
      lastStartAt: Date.now(),
      lastError: null,
    });

    const wsClient = new WSClient({
      botId: account.botId,
      secret: account.secret,
      wsUrl: account.websocketUrl,
      logger,
      heartbeatInterval: WS_HEARTBEAT_INTERVAL_MS,
      maxReconnectAttempts: WS_MAX_RECONNECT_ATTEMPTS,
      maxAuthFailureAttempts: WS_MAX_AUTH_FAILURE_ATTEMPTS,
      scene: SCENE_WECOM_OPENCLAW,
      plug_version: PLUGIN_VERSION,
    });

    // 防止 cleanup 被多次调用（abort handler、error handler、disconnected_event 可能竞态触发）
    let cleanedUp = false;

    // 清理函数：确保所有资源被释放（幂等）
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      stopMessageStateCleanup();
      await cleanupAccount(account.accountId);
    };

    // 处理中止信号（框架 stopChannel 会触发 abort）
    // resolve() 让 Promise settle → 框架清理 store.tasks/store.aborts
    if (abortSignal) {
      abortSignal.addEventListener("abort", async () => {
        runtime.log?.(
          `[wecom][lifecycle] account=${account.accountId} stage=stop_requested uptimeMs=${Date.now() - lifecycleStartedAt}`,
        );
        wsClient.disconnect();
        await cleanup();
        setStatus?.({
          accountId: account.accountId,
          running: false,
          connected: false,
          lifecycle: "stopped",
          lastStopAt: Date.now(),
        });
        resolve();
      });
    }

    // 监听连接事件
    wsClient.on("connected", () => {
      runtime.log?.(
        `[wecom][lifecycle] account=${account.accountId} stage=socket_connected connectMs=${Date.now() - lifecycleStartedAt}`,
      );
      setStatus?.({
        accountId: account.accountId,
        running: true,
        connected: true,
        lifecycle: "starting",
        lastConnectedAt: Date.now(),
      });
    });

    // 监听认证成功事件
    wsClient.on("authenticated", () => {
      runtime.log?.(
        `[wecom][lifecycle] account=${account.accountId} stage=authenticated readyMs=${Date.now() - lifecycleStartedAt}`,
      );
      setWeComWebSocket(account.accountId, wsClient);
      setStatus?.({
        accountId: account.accountId,
        running: true,
        connected: true,
        lifecycle: "ready",
        lastError: null,
      });
    });

    // 监听断开事件
    wsClient.on("disconnected", (reason) => {
      runtime.log?.(
        `[wecom][lifecycle] account=${account.accountId} stage=socket_disconnected uptimeMs=${Date.now() - lifecycleStartedAt} reason=${sanitizeSdkLog(String(reason))}`,
      );
      setStatus?.({
        accountId: account.accountId,
        connected: false,
        lifecycle: "recovering",
        lastDisconnect: { at: Date.now(), error: String(reason) },
      });
    });

    // 监听被踢下线事件（服务端因新连接建立而主动断开旧连接）
    //
    // SDK 内部已设置 isManualClose=true 阻止 SDK 层自动重连，连接不会自行恢复。
    // **不 reject/resolve Promise**——保持 pending 以阻止框架层 auto-restart。
    //
    // 为什么不能 reject/resolve：
    //   - reject → 框架 auto-restart 介入 → 新连接建立 → 又被踢 → 两个实例互踢无限循环
    //   - resolve → 同上，框架 .then() 中的 auto-restart 也会触发
    //
    // Promise pending 的安全性：
    //   - store.tasks.has(id) = true → 阻止 Health Monitor 直接 startChannel（startChannel 检查 tasks.has）
    //   - 框架 stopChannel → abort() → abort handler 中 resolve() → tasks 正常清理
    //   - 用户修改配置 → config reload → stopChannel + startChannel → 正常恢复
    //
    // 显式调用 wsClient.disconnect() 确保 SDK 内部资源（定时器、队列等）完全释放。
    wsClient.on("event.disconnected_event", async () => {
      const errorMsg = `Kicked by server: a new connection was established elsewhere. Auto-restart is suppressed to avoid mutual kicking. Please check for duplicate instances.`;
      runtime.error?.(
        `[wecom][lifecycle] account=${account.accountId} stage=blocked reason=duplicate_connection action=stop_other_instance`,
      );
      wsClient.disconnect();
      await cleanup();
      setStatus?.({
        accountId: account.accountId,
        running: false,
        connected: false,
        lifecycle: "blocked",
        lastError: errorMsg,
        lastStopAt: Date.now(),
      });
      // Promise 保持 pending，不触发 auto-restart
    });

    // 监听重连事件
    wsClient.on("reconnecting", (attempt) => {
      runtime.log?.(
        `[wecom][lifecycle] account=${account.accountId} stage=reconnecting attempt=${attempt} elapsedMs=${Date.now() - lifecycleStartedAt}`,
      );
      setStatus?.({
        accountId: account.accountId,
        running: true,
        connected: false,
        lifecycle: "recovering",
        reconnectAttempts: attempt,
      });
    });

    // 监听错误事件
    wsClient.on("error", async (error) => {
      runtime.error?.(
        `[wecom][lifecycle] account=${account.accountId} stage=socket_error elapsedMs=${Date.now() - lifecycleStartedAt} ${formatDiagnosticError(error)}`,
      );

      if (error instanceof WSAuthFailureError) {
        // 认证失败重试次数用尽（SDK 层已重试 WS_MAX_AUTH_FAILURE_ATTEMPTS 次）。
        // 配置错误（如 botId/secret 无效），框架 auto-restart 也无法恢复。
        //
        // **不 reject/resolve Promise**——保持 pending 以阻止框架层 auto-restart。
        //
        // 为什么不能 reject/resolve：
        //   - reject/resolve → 框架 auto-restart（最多 10 次）× SDK 重试（5 次）= 60 次无意义尝试
        //   - 且 Health Monitor 每小时还会 resetRestartAttempts 再来一轮
        //
        // Promise pending 的安全性：同被踢下线场景
        //   - store.tasks.has(id) = true → 阻止 Health Monitor 直接 startChannel
        //   - 框架 stopChannel / config reload → abort handler 中 resolve() → 正常清理
        //   - 用户修改配置后框架通过 reload 机制重新启动
        const errorMsg = `Auth failure attempts exhausted (${WS_MAX_AUTH_FAILURE_ATTEMPTS} attempts). Please check botId/secret configuration.`;
        runtime.error?.(
          `[wecom][lifecycle] account=${account.accountId} stage=blocked reason=authentication_failed attempts=${WS_MAX_AUTH_FAILURE_ATTEMPTS} action=check_account_credentials`,
        );
        wsClient.disconnect();
        await cleanup();
        setStatus?.({
          accountId: account.accountId,
          running: false,
          connected: false,
          lifecycle: "blocked",
          lastError: errorMsg,
          lastStopAt: Date.now(),
        });
        return;
      }

      if (error instanceof WSReconnectExhaustedError) {
        // 网络断线重连次数用尽（SDK 层已重试 WS_MAX_RECONNECT_ATTEMPTS 次）。
        // 通常是网络/服务端问题，框架 auto-restart 可能恢复。
        //
        // reject Promise → 框架 auto-restart 介入（最多 MAX_RESTART_ATTEMPTS=10 次）
        // 总连接尝试次数 = (1 首次 + WS_MAX_RECONNECT_ATTEMPTS 重连) × (1 首轮 + 10 auto-restart)
        //                = 11 × 11 = 121 次
        //
        // 如果 Health Monitor 介入（每 5 分钟检查），会 resetRestartAttempts 重新计数，
        // 受限于 DEFAULT_MAX_RESTARTS_PER_HOUR=10，每小时最多额外 10 × 121 = 1210 次。
        // 但因网络断线通常是暂时性的，auto-restart + Health Monitor 的兜底机制是合理的。
        //
        // 显式调用 wsClient.disconnect() 确保 SDK 内部资源完全释放，
        // 避免旧实例的定时器/队列残留。
        wsClient.disconnect();
        setStatus?.({
          accountId: account.accountId,
          running: false,
          connected: false,
          lifecycle: "recovering",
          lastError: error.message,
          lastStopAt: Date.now(),
        });
        cleanup().finally(() => reject(error));
        return;
      }
    });

    // 监听版本检查事件：收到 enter_check_update 时回复当前插件版本
    wsClient.on(EVENT_ENTER_CHECK_UPDATE as any, async (frame: WsFrame) => {
      const traceId = wecomFlowId({ accountId: account.accountId, reqId: frame.headers.req_id });
      try {
        runtime.log?.(
          `[wecom][lifecycle] account=${account.accountId} trace=${traceId} stage=version_check_received pluginVersion=${PLUGIN_VERSION}`,
        );
        await wsClient.reply(frame, { version: PLUGIN_VERSION }, CMD_ENTER_EVENT_REPLY);
        runtime.log?.(
          `[wecom][lifecycle] account=${account.accountId} trace=${traceId} stage=version_check_replied pluginVersion=${PLUGIN_VERSION}`,
        );
      } catch (err) {
        runtime.error?.(
          `[wecom][lifecycle] account=${account.accountId} trace=${traceId} stage=version_check_failed ${formatDiagnosticError(err)}`,
        );
      }
    });

    // 监听普通消息
    wsClient.on("message", async (frame: WsFrame) => {
      try {
        const entry = await prepareWeComMessage({
          frame,
          account,
          config,
          runtime,
          wsClient,
        });
        if (!entry) return;

        // 按 accountId:chatId 串行排队，保证同一会话消息按序处理，
        // 避免并发触发 OpenClaw 前台回复栅栏（ForegroundReplyFence）互相抑制
        // 导致较早消息的流式回复被丢弃、thinking 流无法 finish 而一直 loading。
        const { status } = enqueueWeComChatTask({
          accountId: entry.account.accountId,
          chatId: entry.chatId,
          task: () => processWeComMessageNow(entry),
        });

        runtime.log?.(
          `[wecom][flow] trace=${entry.traceId} stage=queue_${status} account=${entry.account.accountId} chat=${diagnosticFingerprint(entry.chatId)}`,
        );

        if (status === "queued") {
          runtime.log?.(`[wecom][flow] trace=${entry.traceId} stage=queue_wait reason=previous_task_running`);
        }
      } catch (err) {
        runtime.error?.(
          `[wecom][flow] trace=${wecomFlowId({ accountId: account.accountId, reqId: frame.headers.req_id })} stage=inbound_failed account=${account.accountId} ${formatDiagnosticError(err)}`,
        );
      }
    });

    // 监听所有事件回调（aibot_event_callback）。
    // 这里使用通用 event 监听，再按 eventtype 分发，兼容不同 SDK 版本在细分事件名上的差异。
    wsClient.on("event", async (frame: WsFrame) => {
      try {
        const eventBody = frame.body as MessageBody;
        const eventType = eventBody.event?.eventtype;
        const eventTrace = wecomFlowId({
          accountId: account.accountId,
          reqId: frame.headers.req_id,
          messageId: eventBody.msgid,
        });
        runtime.log?.(
          `[wecom][flow] trace=${eventTrace} stage=event_received account=${account.accountId} eventType=${eventType ?? "unknown"} message=${diagnosticFingerprint(eventBody.msgid)}`,
        );

        if (eventType === "template_card_event") {
          const templateCardEvent = eventBody.event?.template_card_event;
          runtime.log?.(
            `[wecom][flow] trace=${eventTrace} stage=template_card_event account=${account.accountId} eventKey=${diagnosticFingerprint(templateCardEvent?.event_key)} task=${diagnosticFingerprint(templateCardEvent?.task_id)}`,
          );

          try {
            await updateTemplateCardOnEvent({
              frame,
              accountId: account.accountId,
              runtime,
              wsClient,
            });
          } catch (updateErr) {
            runtime.error?.(
              `[wecom][template-card] trace=${eventTrace} account=${account.accountId} stage=update_failed ${formatDiagnosticError(updateErr)}`,
            );
          }
        } else if (eventType === "auth_change_event") {
          const authChangeEvent = eventBody.event?.auth_change_event;
          runtime.log?.(
            `[wecom][flow] trace=${eventTrace} stage=auth_change_event account=${account.accountId} authCount=${authChangeEvent?.auth_list?.length ?? 0}`,
          );
        } else {
          // 其他未识别的事件类型，跳过
          return;
        }

        const entry = await prepareWeComMessage({
          frame,
          account,
          config,
          runtime,
          wsClient,
        });
        if (entry) {
          // 事件回调与普通消息共用同一会话队列，保证严格串行
          enqueueWeComChatTask({
            accountId: entry.account.accountId,
            chatId: entry.chatId,
            task: () => processWeComMessageNow(entry),
          });
        }
      } catch (err) {
        runtime.error?.(
          `[wecom][flow] trace=${wecomFlowId({ accountId: account.accountId, reqId: frame.headers.req_id })} stage=event_failed account=${account.accountId} eventType=${(frame.body as MessageBody)?.event?.eventtype ?? "unknown"} ${formatDiagnosticError(err)}`,
        );
      }
    });

    runtime.log?.(
      `[wecom][lifecycle] account=${account.accountId} stage=listeners_attached listeners=message,template_card_event,auth_change_event`,
    );

    // 启动前预热 reqId 缓存，确保完成后再建立连接，避免 getSync 在预热完成前返回 undefined
    warmupReqIdStore(account.accountId, (...args) => runtime.log?.(...args))
      .then((count) => {
        runtime.log?.(
          `[wecom][lifecycle] account=${account.accountId} stage=reqid_store_ready entries=${count} storage=memory`,
        );
      })
      .catch((err) => {
        runtime.error?.(
          `[wecom][lifecycle] account=${account.accountId} stage=reqid_store_failed ${formatDiagnosticError(err)}`,
        );
      })
      .finally(() => {
        // 无论预热成功或失败，都建立连接
        wsClient.connect();
      });
  });
}
