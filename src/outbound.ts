import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk/channel-send-result";
import type { ResolvedAgentAccount } from "./types/account.js";
import { WecomAgentDeliveryService } from "./capability/agent/index.js";
import { WecomUpstreamAgentDeliveryService } from "./capability/agent/upstream-delivery-service.js";
import {
  resolveWecomMarkdownFormat,
  resolveWecomMergedMediaLocalRoots,
  resolveWecomMediaMaxBytes,
  resolveWecomAccount,
  resolveWecomAccountConflict,
  resolveWecomAccounts,
} from "./config/index.js";
import {
  getAccountRuntime,
  getActiveBotWsReplyHandle,
  getBotWsPushHandle,
  getWecomRuntime,
} from "./runtime.js";
import { getPeerUpstreamCorpId } from "./context-store.js";
import { resolveWecomSourceSnapshot } from "./runtime/source-registry.js";
import { chunkTextToByteLimit } from "./shared/byte-chunking.js";
import { resolveOutboundMediaAsset } from "./shared/media-asset.js";
import { resolveScopedWecomTarget } from "./target.js";
import { MESSAGE_BYTE_LIMITS } from "./types/constants.js";
import { toWeComMarkdownV2 } from "./wecom_msg_adapter/markdown_adapter.js";
import { parseUpstreamAgentSessionTarget, createUpstreamAgentConfig, resolveUpstreamCorpConfig } from "./upstream/index.js";

type WecomOutboundBaseContext = Parameters<NonNullable<ChannelOutboundAdapter["sendText"]>>[0];
type WecomOutboundContext = WecomOutboundBaseContext & {
  sessionKey?: string | null;
};
type WecomOutboundConfig = WecomOutboundContext["cfg"];

type ResolvedOutboundContext = {
  rawTo: string;
  explicitAgentTarget: boolean;
  scopedAccountId?: string;
  peerKind?: "direct" | "group";
  peerId?: string;
  source?: ReturnType<typeof resolveWecomSourceSnapshot>;
  peerUpstreamCorpId?: string;
};

function resolveOutboundContext(params: {
  to: string | undefined;
  accountId?: string | null;
  sessionKey?: string | null;
}): ResolvedOutboundContext {
  const rawTo = String(params.to ?? "").trim();
  const fallbackAccountId = params.accountId?.trim();
  const scoped = resolveScopedWecomTarget(params.to, fallbackAccountId);
  const scopedAccountId = scoped?.accountId?.trim() || fallbackAccountId;
  const peerId = scoped?.target.touser?.trim() || scoped?.target.chatid?.trim();
  const peerKind = scoped?.target.chatid ? "group" : scoped?.target.touser ? "direct" : undefined;
  const source = scopedAccountId
    ? resolveWecomSourceSnapshot({
        accountId: scopedAccountId,
        sessionKey: params.sessionKey,
        peerKind,
        peerId,
      })
    : undefined;
  const peerUpstreamCorpId =
    scopedAccountId && peerKind === "direct" && peerId
      ? getPeerUpstreamCorpId(scopedAccountId, peerId)?.trim()
      : undefined;
  return {
    rawTo,
    explicitAgentTarget: isExplicitAgentTarget(params.to),
    scopedAccountId,
    peerKind,
    peerId,
    source,
    peerUpstreamCorpId,
  };
}

function logOutboundDecision(params: {
  phase: string;
  to: string | undefined;
  accountId?: string | null;
  sessionKey?: string | null;
  textLen?: number;
  mediaUrl?: string;
  extra?: string;
}): void {
  const resolved = resolveOutboundContext(params);
  const runtimeAccountId = resolved.scopedAccountId || params.accountId?.trim();
  const logger = runtimeAccountId ? getAccountRuntime(runtimeAccountId)?.log.info : undefined;
  logger?.(
    `[wecom-outbound] ${params.phase} rawTo=${resolved.rawTo || "N/A"} scopedAccount=${resolved.scopedAccountId ?? "N/A"} ` +
      `peer=${resolved.peerKind && resolved.peerId ? `${resolved.peerKind}:${resolved.peerId}` : "N/A"} ` +
      `explicitAgent=${String(resolved.explicitAgentTarget)} source=${resolved.source?.source ?? "none"} ` +
      `sourceUpstreamCorpId=${resolved.source?.upstreamCorpId ?? "none"} peerUpstreamCorpId=${resolved.peerUpstreamCorpId ?? "none"} ` +
      `sessionKey=${params.sessionKey?.trim() || "N/A"} textLen=${String(params.textLen ?? 0)} ` +
      `mediaUrl=${params.mediaUrl ?? "N/A"}${params.extra ? ` ${params.extra}` : ""}`,
  );
}

function resolveOutboundAccountOrThrow(params: {
  cfg: WecomOutboundConfig;
  accountId?: string | null;
}) {
  const resolvedAccounts = resolveWecomAccounts(params.cfg);
  const conflictAccountId = params.accountId?.trim() || resolvedAccounts.defaultAccountId;
  const conflict = resolveWecomAccountConflict({
    cfg: params.cfg,
    accountId: conflictAccountId,
  });
  if (conflict) {
    throw new Error(conflict.message);
  }

  const requestedAccountId = params.accountId?.trim();
  if (requestedAccountId) {
    if (!resolvedAccounts.accounts[requestedAccountId]) {
      throw new Error(
        `WeCom outbound account "${requestedAccountId}" not found. Configure channels.wecom.accounts.${requestedAccountId} or use an existing accountId.`,
      );
    }
  }
  return resolveWecomAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
}

function resolveAgentConfigOrThrow(params: {
  cfg: WecomOutboundConfig;
  accountId?: string | null;
}) {
  const account = resolveOutboundAccountOrThrow(params).agent;
  if (!account?.apiConfigured) {
    throw new Error(
      `WeCom outbound requires Agent mode for account=${params.accountId ?? "default"}. Configure channels.wecom.accounts.<accountId>.agent (or legacy channels.wecom.agent).`,
    );
  }
  if (typeof account.agentId !== "number" || !Number.isFinite(account.agentId)) {
    throw new Error(
      `WeCom outbound requires channels.wecom.accounts.<accountId>.agent.agentId (or legacy channels.wecom.agent.agentId) for account=${params.accountId ?? account.accountId}.`,
    );
  }
  // 注意：不要在日志里输出 corpSecret 等敏感信息
  getAccountRuntime(account.accountId)?.log.info?.(
    `[wecom-outbound] Using agent config: accountId=${account.accountId}, corpId=${account.corpId}, agentId=${account.agentId}`,
  );
  return account;
}

function isExplicitAgentTarget(raw: string | undefined): boolean {
  return /^wecom-agent(?:-upstream)?:/i.test(String(raw ?? "").trim());
}

function isAgentConversationTarget(params: {
  to: string | undefined;
  accountId?: string | null;
  sessionKey?: string | null;
}): boolean {
  if (isExplicitAgentTarget(params.to)) {
    return true;
  }

  const fallbackAccountId = params.accountId?.trim();
  const scoped = resolveScopedWecomTarget(params.to, fallbackAccountId);
  const resolvedAccountId = scoped?.accountId?.trim() || fallbackAccountId;
  if (!resolvedAccountId) {
    return false;
  }

  const peerId = scoped?.target.touser?.trim() || scoped?.target.chatid?.trim();
  const peerKind = scoped?.target.chatid ? "group" : scoped?.target.touser ? "direct" : undefined;
  const source = resolveWecomSourceSnapshot({
    accountId: resolvedAccountId,
    sessionKey: params.sessionKey,
    peerKind,
    peerId,
  });
  return source?.source === "agent-callback";
}

/**
 * 解析上下游目标,返回解析后的信息或 undefined
 */
function resolveUpstreamTarget(params: {
  to: string | undefined;
  cfg: WecomOutboundConfig;
  accountId?: string | null;
  sessionKey?: string | null;
}): { upstreamAgent: ResolvedAgentAccount; primaryAgent: ResolvedAgentAccount; toUser: string } | undefined {
  const parsedExplicit = parseUpstreamAgentSessionTarget(params.to ?? "");
  const isExplicitUpstreamTarget = Boolean(parsedExplicit);

  const parsed = (() => {
    if (parsedExplicit) {
      return parsedExplicit;
    }

    const fallbackAccountId = params.accountId?.trim();
    const scoped = resolveScopedWecomTarget(params.to, fallbackAccountId);
    const toUser = scoped?.target.touser?.trim();
    const resolvedAccountId = scoped?.accountId?.trim() || fallbackAccountId;
    if (!toUser || !resolvedAccountId) {
      return undefined;
    }

    const source = resolveWecomSourceSnapshot({
      accountId: resolvedAccountId,
      sessionKey: params.sessionKey,
      peerKind: "direct",
      peerId: toUser,
    });
    const upstreamCorpId =
      source?.upstreamCorpId?.trim() || getPeerUpstreamCorpId(resolvedAccountId, toUser)?.trim();
    if (!upstreamCorpId) {
      return undefined;
    }

    return {
      accountId: resolvedAccountId,
      upstreamCorpId,
      userId: toUser,
    };
  })();

  if (!parsed) {
    return undefined;
  }

  const { accountId, upstreamCorpId, userId } = parsed;
  const account = resolveOutboundAccountOrThrow({ cfg: params.cfg, accountId });

  if (!account.agent?.apiConfigured) {
    if (isExplicitUpstreamTarget) {
      throw new Error(
        `WeCom upstream outbound requires Agent mode for account=${accountId}.`,
      );
    }
    return undefined;
  }

  // 查找上下游配置
  const upstreamConfig = resolveUpstreamCorpConfig({
    upstreamCorpId,
    upstreamCorps: account.agent.config.upstreamCorps,
  });

  if (!upstreamConfig) {
    if (isExplicitUpstreamTarget) {
      throw new Error(
        `WeCom upstream outbound: no upstream corp config found for corpId=${upstreamCorpId}. ` +
        `Please configure channels.wecom.accounts.${accountId}.agent.upstreamCorps with corpId=${upstreamCorpId}.`,
      );
    }
    return undefined;
  }

  // 创建上下游 Agent 配置
  // 注意:使用下游企业的 corpId 和 agentId,但保持主企业的 corpSecret
  const upstreamAgent = createUpstreamAgentConfig({
    baseAgent: account.agent,
    upstreamCorpId,
    upstreamAgentId: upstreamConfig.agentId,
  });

  return { upstreamAgent, primaryAgent: account.agent, toUser: userId };
}

function resolveBotWsChatTarget(params: {
  to: string | undefined;
  accountId: string;
}): string | undefined {
  const scoped = resolveScopedWecomTarget(params.to, params.accountId);
  if (!scoped) {
    return undefined;
  }
  if (scoped.accountId && scoped.accountId !== params.accountId) {
    throw new Error(
      `WeCom outbound account mismatch: target belongs to account=${scoped.accountId}, current account=${params.accountId}.`,
    );
  }
  if (scoped.target.chatid) {
    return scoped.target.chatid;
  }
  if (scoped.target.touser) {
    return scoped.target.touser;
  }
  return undefined;
}

function resolveOutboundPeer(params: {
  to: string | undefined;
  accountId: string;
}): { peerKind: "direct" | "group"; peerId: string } | undefined {
  const scoped = resolveScopedWecomTarget(params.to, params.accountId);
  if (!scoped) {
    return undefined;
  }
  if (scoped.accountId && scoped.accountId !== params.accountId) {
    return undefined;
  }
  if (scoped.target.chatid) {
    return { peerKind: "group", peerId: scoped.target.chatid };
  }
  if (scoped.target.touser) {
    return { peerKind: "direct", peerId: scoped.target.touser };
  }
  return undefined;
}

function shouldPreferBotWsOutbound(params: {
  cfg: WecomOutboundConfig;
  accountId?: string | null;
  to: string | undefined;
  sessionKey?: string | null;
}): { preferred: boolean; accountId: string } {
  const account = resolveOutboundAccountOrThrow({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const peer = resolveOutboundPeer({
    to: params.to,
    accountId: account.accountId,
  });
  const source = resolveWecomSourceSnapshot({
    accountId: account.accountId,
    sessionKey: params.sessionKey,
    peerKind: peer?.peerKind,
    peerId: peer?.peerId,
  });
  const pinnedToAgent = source?.source === "agent-callback";
  const pinnedToBotWs = source?.source === "bot-ws";
  return {
    preferred:
      !isExplicitAgentTarget(params.to) &&
      !pinnedToAgent &&
      Boolean(
        account.bot?.configured &&
        account.bot.wsConfigured &&
        (pinnedToBotWs || account.bot.primaryTransport === "ws"),
      ),
    accountId: account.accountId,
  };
}

function markActiveBotWsReplyHandleActivity(params: {
  accountId: string;
  sessionKey?: string | null;
  to: string | undefined;
}): void {
  const peer = resolveOutboundPeer({
    to: params.to,
    accountId: params.accountId,
  });
  const handle = getActiveBotWsReplyHandle({
    accountId: params.accountId,
    sessionKey: params.sessionKey,
    peerKind: peer?.peerKind,
    peerId: peer?.peerId,
  });
  handle?.markExternalActivity?.();
}

async function sendTextViaBotWs(params: {
  cfg: WecomOutboundConfig;
  accountId?: string | null;
  to: string | undefined;
  text: string;
  sessionKey?: string | null;
}): Promise<boolean> {
  const { preferred, accountId } = shouldPreferBotWsOutbound(params);
  if (!preferred) {
    return false;
  }
  const chatId = resolveBotWsChatTarget({
    to: params.to,
    accountId,
  });
  if (!chatId) {
    return false;
  }
  const handle = getBotWsPushHandle(accountId);
  if (!handle) {
    throw new Error(
      `WeCom outbound account=${accountId} is configured for Bot WS active push, but no live WS runtime is registered.`,
    );
  }
  if (!handle.isConnected()) {
    throw new Error(
      `WeCom outbound account=${accountId} is configured for Bot WS active push, but the WS transport is not connected.`,
    );
  }
  const markdownText = toWeComMarkdownV2(params.text);
  console.log(
    `[wecom-outbound] Sending Bot WS active message to target=${String(params.to ?? "")} chatId=${chatId} (len=${markdownText.length})`,
  );
  await handle.sendMarkdown(chatId, markdownText);
  markActiveBotWsReplyHandleActivity({
    accountId,
    sessionKey: params.sessionKey,
    to: params.to,
  });
  console.log(`[wecom-outbound] Successfully sent Bot WS active message to ${chatId}`);
  return true;
}

async function sendMediaViaBotWs(params: {
  cfg: WecomOutboundConfig;
  accountId?: string | null;
  to: string | undefined;
  mediaUrl: string;
  text?: string;
  mediaLocalRoots?: readonly string[];
  sessionKey?: string | null;
}): Promise<{
  attempted: boolean;
  sent: boolean;
  reason?: string;
}> {
  const { preferred, accountId } = shouldPreferBotWsOutbound(params);
  if (!preferred) {
    return { attempted: false, sent: false };
  }
  const chatId = resolveBotWsChatTarget({
    to: params.to,
    accountId,
  });
  if (!chatId) {
    return { attempted: false, sent: false };
  }
  const handle = getBotWsPushHandle(accountId);
  if (!handle) {
    throw new Error(
      `WeCom outbound account=${accountId} is configured for Bot WS active push, but no live WS runtime is registered.`,
    );
  }
  if (!handle.isConnected()) {
    throw new Error(
      `WeCom outbound account=${accountId} is configured for Bot WS active push, but the WS transport is not connected.`,
    );
  }
  console.log(
    `[wecom-outbound] Sending Bot WS media to target=${String(params.to ?? "")} chatId=${chatId} media=${params.mediaUrl}`,
  );
  const effectiveMediaLocalRoots = resolveWecomMergedMediaLocalRoots({
    cfg: params.cfg,
    baseRoots: params.mediaLocalRoots,
  });
  const result = await handle.sendMedia({
    chatId,
    mediaUrl: params.mediaUrl,
    text: params.text,
    mediaLocalRoots: effectiveMediaLocalRoots,
    maxBytes: resolveWecomMediaMaxBytes(params.cfg, accountId),
  });
  if (result.ok) {
    markActiveBotWsReplyHandleActivity({
      accountId,
      sessionKey: params.sessionKey,
      to: params.to,
    });
    console.log(`[wecom-outbound] Successfully sent Bot WS media to ${chatId}`);
    return { attempted: true, sent: true };
  }
  const reason = result.rejectReason || result.error || "unknown";
  console.warn(`[wecom-outbound] Bot WS media failed for ${chatId}: ${reason}`);
  return { attempted: true, sent: false, reason };
}

export const wecomOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunkerMode: "text",
  /**
   * 这层是 core 的预分片，对所有传输共用，所以取最宽的那个上限
   * （Bot WS 流式 20480 字节）；更窄的 Agent 2048 由各 delivery-service
   * 自己再切一次。收到 2048 会让 WS 流式路径被无谓地多切。
   */
  textChunkLimit: MESSAGE_BYTE_LIMITS.BOT_WS_STREAM,
  chunker: (text: string, limit: number) => {
    try {
      // limit 语义是字节，chunkText 按字符切，所以要过一遍字节收敛。
      return chunkTextToByteLimit(text, limit, (value, charLimit) =>
        getWecomRuntime().channel.text.chunkText(value, charLimit),
      );
    } catch {
      return [text];
    }
  },
  sendText: async ({ cfg, to, text, accountId, sessionKey }: WecomOutboundContext) => {
    // signal removed - not supported in current SDK
    // Defer Agent resolution until the Agent fallback path
    // sendTextViaBotWs() can already deliver without Agent mode

    // 体验优化：/new /reset 的“New session started”回执在 OpenClaw 核心里是英文固定文案，
    // 且通过 routeReply 走 wecom outbound（Agent 主动发送）。
    // 在 WeCom“双模式”场景下，这会造成：
    // - 用户在 Bot 会话发 /new，但却收到一条 Agent 私信回执（双重回复/错会话）。
    // 因此：
    // - Bot 会话目标：抑制该回执（Bot 会话里由 wecom 插件补中文回执）。
    // - Agent 会话目标（wecom-agent:）：允许发送，但改写成中文。
    let outgoingText = text;
    const trimmed = String(outgoingText ?? "").trim();
    logOutboundDecision({
      phase: "sendText:start",
      to,
      accountId,
      sessionKey,
      textLen: trimmed.length,
    });
    const isAgentSessionTarget = isAgentConversationTarget({ to, accountId, sessionKey });
    const looksLikeNewSessionAck = /new session started/i.test(trimmed) && /model:/i.test(trimmed);

    if (looksLikeNewSessionAck) {
      if (!isAgentSessionTarget) {
        logOutboundDecision({
          phase: "sendText:suppress-new-session-ack",
          to,
          accountId,
          sessionKey,
          textLen: trimmed.length,
        });
        // Suppress ack without agent resolution
        return { channel: "wecom", messageId: `suppressed-${Date.now()}`, timestamp: Date.now() };
      }

      const modelLabel = (() => {
        const m = trimmed.match(/model:\s*([^\n()]+)\s*/i);
        return m?.[1]?.trim();
      })();
      const rewritten = modelLabel ? `✅ 已开启新会话（模型：${modelLabel}）` : "✅ 已开启新会话。";
      outgoingText = rewritten;
      logOutboundDecision({
        phase: "sendText:rewrite-new-session-ack",
        to,
        accountId,
        sessionKey,
        textLen: outgoingText.length,
      });
    }

    let sentViaBotWs = false;
    let agent: ReturnType<typeof resolveAgentConfigOrThrow> | null = null;
    let upstreamTarget: ReturnType<typeof resolveUpstreamTarget> | undefined;
    let agentMessageIds: string[] = [];

    try {
      // 首先检查是否是上下游用户
      upstreamTarget = resolveUpstreamTarget({ to, cfg, accountId, sessionKey });
      
      if (upstreamTarget) {
        logOutboundDecision({
          phase: "sendText:path-upstream",
          to,
          accountId,
          sessionKey,
          textLen: outgoingText.length,
          extra: `resolvedUser=${upstreamTarget.toUser} corpId=${upstreamTarget.upstreamAgent.corpId}`,
        });
        // 上下游用户使用专门的 DeliveryService 发送
        getAccountRuntime(upstreamTarget.upstreamAgent.accountId)?.log.info?.(
          `[wecom-outbound] Sending text to upstream target corpId=${upstreamTarget.upstreamAgent.corpId} (len=${outgoingText.length})`,
        );
        const deliveryService = new WecomUpstreamAgentDeliveryService(
          upstreamTarget.upstreamAgent,
          upstreamTarget.primaryAgent,
        );
        const deliveryResult = await deliveryService.sendText({
          to,
          text: outgoingText,
          format: resolveWecomMarkdownFormat(cfg, upstreamTarget.upstreamAgent.accountId),
        });
        agentMessageIds = deliveryResult.messageIds;
        return {
          channel: "wecom",
          messageId: agentMessageIds[0] ?? `upstream-agent-${Date.now()}`,
          timestamp: Date.now(),
        };
      }
      sentViaBotWs = await sendTextViaBotWs({
        cfg,
        accountId,
        to,
        text: outgoingText,
        sessionKey,
      });
      if (!sentViaBotWs) {
        // Defer Agent resolution until needed for fallback
        agent = resolveAgentConfigOrThrow({ cfg, accountId });
        logOutboundDecision({
          phase: "sendText:path-agent",
          to,
          accountId: agent.accountId,
          sessionKey,
          textLen: outgoingText.length,
        });
        getAccountRuntime(agent.accountId)?.log.info?.(
          `[wecom-outbound] Sending text to target=${String(to ?? "")} (len=${outgoingText.length})`,
        );
        const deliveryService = new WecomAgentDeliveryService(agent);
        const deliveryResult = await deliveryService.sendText({
          to,
          text: outgoingText,
          format: resolveWecomMarkdownFormat(cfg, agent.accountId),
        });
        agentMessageIds = deliveryResult.messageIds;
      } else {
        logOutboundDecision({
          phase: "sendText:path-bot-ws",
          to,
          accountId,
          sessionKey,
          textLen: outgoingText.length,
        });
      }
    } catch (err) {
      console.error(`[wecom-outbound] FAILED to send: ${err instanceof Error ? err.message : String(err)}`);
      if (agent) {
        getAccountRuntime(agent.accountId)?.log.error?.(
          `[wecom-outbound] Failed to send text to ${String(to ?? "")}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      throw err;
    }

    return {
      channel: "wecom",
      messageId: sentViaBotWs ? `bot-ws-${Date.now()}` : (agentMessageIds[0] ?? `agent-${Date.now()}`),
      timestamp: Date.now(),
    };
  },
  sendMedia: async ({
    cfg,
    to,
    text,
    mediaUrl,
    accountId,
    mediaLocalRoots,
    sessionKey,
  }: WecomOutboundContext) => {
    // signal removed - not supported in current SDK
    if (!mediaUrl) {
      throw new Error("WeCom outbound requires mediaUrl.");
    }

    logOutboundDecision({
      phase: "sendMedia:start",
      to,
      accountId,
      sessionKey,
      textLen: String(text ?? "").trim().length,
      mediaUrl,
    });

    // 首先检查是否是上下游用户
    const upstreamTarget = resolveUpstreamTarget({ to, cfg, accountId, sessionKey });
    if (upstreamTarget) {
      logOutboundDecision({
        phase: "sendMedia:path-upstream",
        to,
        accountId,
        sessionKey,
        textLen: String(text ?? "").trim().length,
        mediaUrl,
        extra: `resolvedUser=${upstreamTarget.toUser} corpId=${upstreamTarget.upstreamAgent.corpId}`,
      });
      getAccountRuntime(upstreamTarget.upstreamAgent.accountId)?.log.info?.(
        `[wecom-outbound] Sending media to upstream target corpId=${upstreamTarget.upstreamAgent.corpId} (filename=${mediaUrl})`,
      );

      const { buffer, contentType, filename } = await resolveOutboundMediaAsset({
        mediaUrl,
        network: upstreamTarget.upstreamAgent.network,
      });

      const deliveryService = new WecomUpstreamAgentDeliveryService(
        upstreamTarget.upstreamAgent,
        upstreamTarget.primaryAgent,
      );
      const deliveryResult = await deliveryService.sendMedia({
        to,
        text,
        buffer,
        filename,
        contentType,
      });
      return {
        channel: "wecom",
        messageId: deliveryResult.messageIds[0] ?? `upstream-agent-media-${Date.now()}`,
        timestamp: Date.now(),
      };
    }

    const botWs = await sendMediaViaBotWs({
      cfg,
      accountId,
      to,
      text,
      mediaUrl,
      mediaLocalRoots,
      sessionKey,
    });
    if (botWs.sent) {
      logOutboundDecision({
        phase: "sendMedia:path-bot-ws",
        to,
        accountId,
        sessionKey,
        textLen: String(text ?? "").trim().length,
        mediaUrl,
      });
      return {
        channel: "wecom",
        messageId: `bot-ws-media-${Date.now()}`,
        timestamp: Date.now(),
      };
    }
    if (botWs.attempted) {
      throw new Error(
        `WeCom Bot WS media delivery failed for ${String(to ?? "")}: ${botWs.reason ?? "unknown"}`,
      );
    }

    const agent = resolveAgentConfigOrThrow({ cfg, accountId });
    logOutboundDecision({
      phase: "sendMedia:path-agent",
      to,
      accountId: agent.accountId,
      sessionKey,
      textLen: String(text ?? "").trim().length,
      mediaUrl,
    });
    const deliveryService = new WecomAgentDeliveryService(agent);

    const { buffer, contentType, filename } = await resolveOutboundMediaAsset({
      mediaUrl,
      network: agent.network,
    });

    console.log(
      `[wecom-outbound] Sending media to ${String(to ?? "")} (filename=${filename}, contentType=${contentType})`,
    );

    try {
      const deliveryResult = await deliveryService.sendMedia({
        to,
        text,
        buffer,
        filename,
        contentType,
      });
      console.log(`[wecom-outbound] Successfully sent media to ${String(to ?? "")}`);
      return {
        channel: "wecom",
        messageId: deliveryResult.messageIds[0] ?? `${botWs.attempted ? "agent-fallback-media" : "agent-media"}-${Date.now()}`,
        timestamp: Date.now(),
      };
    } catch (err) {
      console.error(`[wecom-outbound] Failed to send media to ${String(to ?? "")}:`, err);
      throw err;
    }
  },
};
