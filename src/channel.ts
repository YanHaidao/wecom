import {
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/core";
import { buildAccountScopedDmSecurityPolicy, type ChannelSecurityDmPolicyCompat } from "./openclaw-compat.js";
import type { ChannelStatusIssue } from "openclaw/plugin-sdk/channel-contract";

import { formatPairingApproveHint, DEFAULT_ACCOUNT_ID } from './openclaw-compat.js'
import { getWeComRuntime } from "./runtime.js";
import { monitorWeComProvider } from "./monitor.js";
import { getWeComWebSocket } from "./state-manager.js";
import { wecomSetupWizard } from "./onboarding.js";
import { wecomSetupContract } from "./setup-core.js";
import { wecomConfigAdapter } from "./config-adapter.js";
import { isWeComAccountConfigured, resolveWeComTransport } from "./config-adapter.js";
import { wecomChannelConfigSchema } from "./config-schema.js";
import { legacyConfigRules, normalizeCompatibilityConfig } from "./doctor-contract.js";
import type { WeComConfig, ResolvedWeComAccount } from "./utils.js";
import {
  resolveWeComAccountMulti,
  resolveDefaultWeComAccountId,
  resolveWeComConfigDiagnostics,
  hasMultiAccounts,
} from "./accounts.js";
import type { WeComMultiAccountConfig } from "./accounts.js";
import { diagnosticFingerprint, formatDiagnosticError, utf8Bytes } from "./diagnostics.js";
import { CHANNEL_ID, TEXT_CHUNK_LIMIT, WEBHOOK_PATHS } from "./const.js";
import {
  applyFileSizeLimits,
  detectWeComMediaType,
  resolveMediaFile,
  uploadAndSendMedia,
} from "./media-uploader.js";
import { registerAgentWebhookTarget, deregisterAgentWebhookTarget } from "./agent/webhook.js";
import { resolveWecomTarget } from "./target.js";
import {
  sendMedia as sendAgentMedia,
  sendText as sendAgentText,
  sendUpstreamMedia,
  sendUpstreamText,
  uploadMedia as uploadAgentMedia,
  uploadUpstreamMedia,
} from "./agent/api-client.js";
import {
  parseUpstreamAgentTarget,
  resolveOutboundUpstreamTarget,
  type ResolvedUpstreamCorp,
} from "./agent/upstream.js";
import type { ResolvedAgentAccount } from "./types/index.js";
import {
  isWebhookGatewayRunning,
  startWebhookGateway,
  stopWebhookGateway,
} from "./webhook/index.js";
import type { ResolvedWebhookAccount, WebhookGatewayContext } from "./webhook/index.js";

function resolveUpstreamOutboundContext(params: {
  to: string;
  accountId: string;
  cfg?: OpenClawConfig;
}): {
  agent: ResolvedAgentAccount;
  upstream: ResolvedUpstreamCorp;
  userId: string;
} | undefined {
  if (!parseUpstreamAgentTarget(params.to)) return undefined;
  if (!params.cfg) {
    throw new Error("WeCom upstream outbound requires channel configuration");
  }
  const account = resolveWeComAccountMulti({ cfg: params.cfg, accountId: params.accountId });
  if (!account.agent?.configured) {
    throw new Error(`WeCom upstream outbound requires Agent mode for account=${params.accountId}`);
  }
  const resolved = resolveOutboundUpstreamTarget({ agent: account.agent, target: params.to });
  if (!resolved) return undefined;
  return { agent: account.agent, ...resolved };
}

async function resolveAgentOutboundMedia(
  mediaUrl: string,
  mediaLocalRoots?: readonly string[],
) {
  const media = await resolveMediaFile(mediaUrl, mediaLocalRoots);
  const detectedType = detectWeComMediaType(media.contentType);
  const sizeCheck = applyFileSizeLimits(media.buffer.length, detectedType, media.contentType);
  if (sizeCheck.shouldReject) {
    throw new Error(sizeCheck.rejectReason ?? "企业微信媒体文件超过允许大小");
  }
  return {
    ...media,
    mediaType: sizeCheck.finalType,
    downgradeNote: sizeCheck.downgradeNote,
  };
}

/**
 * 使用 SDK 的 sendMessage 主动发送企业微信消息
 * 优先 Bot WebSocket，不可用时自动回退到 Agent HTTP API
 */
async function sendWeComMessage({
                                  to,
                                  content,
                                  accountId,
                                  cfg,
                                }: {
  to: string;
  content: string;
  accountId?: string;
  cfg?: OpenClawConfig;
}): Promise<{ channel: string; messageId: string; chatId: string }> {
  const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;

  // Upstream targets carry their account and downstream CorpID. Never pass them
  // through Bot WS or the primary enterprise Agent fallback.
  const upstreamContext = resolveUpstreamOutboundContext({
    to,
    accountId: resolvedAccountId,
    cfg,
  });
  if (upstreamContext) {
    await sendUpstreamText({
      primaryAgent: upstreamContext.agent,
      upstream: upstreamContext.upstream,
      toUser: upstreamContext.userId,
      text: content,
    });
    return {
      channel: CHANNEL_ID,
      messageId: `agent-upstream-${Date.now()}`,
      chatId: upstreamContext.userId,
    };
  }

  // 从 to 中提取目标（格式是 "${CHANNEL_ID}:xxx" 或直接是目标字符串）
  const channelPrefix = new RegExp(`^${CHANNEL_ID}:`, "i");
  const chatId = to.replace(channelPrefix, "");

  // ── 尝试 Bot WebSocket ──
  const wsClient = getWeComWebSocket(resolvedAccountId);
  if (wsClient?.isConnected) {
    const result = await wsClient.sendMessage(chatId, {
      msgtype: 'markdown',
      markdown: { content },
    });
    const messageId = result?.headers?.req_id ?? `wecom-${Date.now()}`;
    return { channel: CHANNEL_ID, messageId, chatId };
  }

  // ── 回退到 Agent HTTP API ──
  if (!cfg) {
    throw new Error(`WSClient not connected for account ${resolvedAccountId} and no config available for Agent fallback`);
  }
  const account = resolveWeComAccountMulti({ cfg, accountId: resolvedAccountId });
  const agent = account.agent;
  if (!agent?.configured) {
    throw new Error(
      `WSClient not connected for account ${resolvedAccountId} and Agent mode is not configured. ` +
      `Please configure either Bot (botId + secret) or Agent (corpId + corpSecret + agentId) for this account.`
    );
  }

  const target = resolveWecomTarget(chatId);
  if (!target) {
    throw new Error(`Cannot resolve outbound target from "${to}"`);
  }

  const startedAt = Date.now();
  const targetId = diagnosticFingerprint(JSON.stringify(target));
  console.log(
    `[wecom][outbound] account=${resolvedAccountId} stage=fallback_start from=bot_ws to=agent_http kind=text target=${targetId} textBytes=${utf8Bytes(content)}`,
  );
  await sendAgentText({
    agent,
    toUser: target.touser,
    toParty: target.toparty,
    toTag: target.totag,
    chatId: target.chatid,
    text: content,
  });
  console.log(
    `[wecom][outbound] account=${resolvedAccountId} stage=fallback_delivered transport=agent_http kind=text target=${targetId} durationMs=${Date.now() - startedAt}`,
  );

  return {
    channel: CHANNEL_ID,
    messageId: `agent-${Date.now()}`,
    chatId,
  };
}

// 企业微信频道元数据
const meta = {
  id: CHANNEL_ID,
  label: "企业微信",
  selectionLabel: "企业微信 (WeCom)",
  detailLabel: "企业微信智能机器人",
  docsPath: `/channels/${CHANNEL_ID}`,
  docsLabel: CHANNEL_ID,
  blurb: "企业微信智能机器人接入插件",
  systemImage: "message.fill",
};
export const wecomPlugin: ChannelPlugin<ResolvedWeComAccount> = {
  id: CHANNEL_ID,
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },
  pairing: {
    idLabel: "wecomUserId",
    normalizeAllowEntry: (entry) => entry.replace(new RegExp(`^(${CHANNEL_ID}|user):`, "i"), "").trim(),
    notifyApproval: async ({ cfg, id }) => {
      // sendWeComMessage({
      //   to: id,
      //   content: " pairing approved",
      //   accountId: cfg.accountId,
      // });
      // Pairing approved for user
    },
  },
  setupWizard: wecomSetupWizard,
  setupContract: wecomSetupContract,
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: {configPrefixes: [`channels.${CHANNEL_ID}`]},
  configSchema: wecomChannelConfigSchema,
  config: wecomConfigAdapter,
  doctor: {
    dmAllowFromMode: "topOnly",
    groupModel: "hybrid",
    groupAllowFromFallbackToAllowFrom: false,
    legacyConfigRules,
    normalizeCompatibilityConfig,
  },
  security: {
    resolveDmPolicy: ({cfg, accountId, account}) => {
      const result = buildAccountScopedDmSecurityPolicy({
        cfg,
        channelKey: CHANNEL_ID,
        accountId,
        fallbackAccountId: account.accountId,
        policy: account.config.dmPolicy,
        allowFrom: account.config.allowFrom ?? [],
        defaultPolicy: "open",
        policyPathSuffix: "dmPolicy",
        approveHint: formatPairingApproveHint(CHANNEL_ID),
        normalizeEntry: (raw) => raw.replace(new RegExp(`^${CHANNEL_ID}:`, "i"), "").trim(),
      });
      return result as ChannelSecurityDmPolicyCompat;
    },
    collectWarnings: ({cfg, accountId}) => {
      const account = resolveWeComAccountMulti({ cfg, accountId });
      const warnings: string[] = [];

      // 动态构造配置路径（区分单账号 / 多账号）
      const isMulti = hasMultiAccounts(cfg);
      const basePath = isMulti && accountId
        ? `channels.${CHANNEL_ID}.accounts.${accountId}.`
        : `channels.${CHANNEL_ID}.`;

      // DM 策略警告
      const dmPolicy = account.config.dmPolicy ?? "open";
      if (dmPolicy === "open") {
        const hasWildcard = (account.config.allowFrom ?? []).some(
          (entry) => String(entry).trim() === "*"
        );
        if (!hasWildcard) {
          warnings.push(
            `- 企业微信[${account.accountId}]私信：dmPolicy="open" 但 allowFrom 未包含 "*"。任何人都可以发消息，但允许列表为空可能导致意外行为。建议设置 ${basePath}allowFrom=["*"] 或使用 dmPolicy="pairing"。`,
          );
        }
      }

      // 群组策略警告
      const defaultGroupPolicy = cfg.channels?.defaults?.groupPolicy;
      const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "open";
      if (groupPolicy === "open") {
        warnings.push(
          `- 企业微信[${account.accountId}]群组：groupPolicy="open" 允许所有群组中的成员触发。设置 ${basePath}groupPolicy="allowlist" + ${basePath}groupAllowFrom 来限制群组。`,
        );
      }

      return warnings;
    },
  },
  messaging: {
    normalizeTarget: (target) => {
      const trimmed = target.trim();
      if (!trimmed) return undefined;
      return trimmed;
    },
    targetResolver: {
      looksLikeId: (id) => {
        const trimmed = id?.trim();
        return Boolean(trimmed);
      },
      hint: "<userId|groupId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },
  agentPrompt: {
    messageToolHints: () => [
      "- 企业微信通讯录、常规文档、会议、日程、待办、智能表格等标准能力必须调用专用 `wecom-cli` tool；不得通过 exec、bash、shell 或 npx 绕过该工具。",
      "- 文档权限诊断、收集表、高级智能表格权限及日历容器等增强能力使用 `wecom_doc` 或 `wecom_calendar`；工具调用必须保持当前企业微信 accountId，禁止跨账号切换。",
      "- 发送图片、视频、语音或文件时使用 `MEDIA:` 指令，遵循 wecom-send-media skill 的大小和降级规则。",
      "- 发送结构化卡片时输出带 card_type 的 JSON 代码块，遵循 wecom-send-template-card skill。",
    ],
  },
  outbound: {
    deliveryMode: "gateway",
    chunker: (text, limit) => getWeComRuntime().channel.text.chunkMarkdownText(text, limit),
    textChunkLimit: TEXT_CHUNK_LIMIT,
    sendText: async ({to, text, accountId, cfg}) => {
      return sendWeComMessage({to, content: text, accountId: accountId ?? undefined, cfg});
    },
    sendMedia: async ({to, text, mediaUrl, mediaLocalRoots, accountId, cfg}) => {
      const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
      const upstreamContext = resolveUpstreamOutboundContext({
        to,
        accountId: resolvedAccountId,
        cfg,
      });

      if (upstreamContext) {
        if (!mediaUrl) {
          return sendWeComMessage({ to, content: text || "", accountId: resolvedAccountId, cfg });
        }
        try {
          const media = await resolveAgentOutboundMedia(mediaUrl, mediaLocalRoots);
          const mediaId = await uploadUpstreamMedia({
            primaryAgent: upstreamContext.agent,
            upstream: upstreamContext.upstream,
            type: media.mediaType,
            buffer: media.buffer,
            filename: media.fileName,
          });
          await sendUpstreamMedia({
            primaryAgent: upstreamContext.agent,
            upstream: upstreamContext.upstream,
            toUser: upstreamContext.userId,
            mediaId,
            mediaType: media.mediaType,
            ...(media.mediaType === "video"
              ? { title: media.fileName, description: "" }
              : {}),
          });
          if (text) {
            await sendUpstreamText({
              primaryAgent: upstreamContext.agent,
              upstream: upstreamContext.upstream,
              toUser: upstreamContext.userId,
              text,
            });
          }
          if (media.downgradeNote) {
            await sendUpstreamText({
              primaryAgent: upstreamContext.agent,
              upstream: upstreamContext.upstream,
              toUser: upstreamContext.userId,
              text: `ℹ️ ${media.downgradeNote}`,
            });
          }
          return {
            channel: CHANNEL_ID,
            messageId: `agent-upstream-media-${Date.now()}`,
            chatId: upstreamContext.userId,
          };
        } catch (error) {
          console.warn(
            `[wecom-outbound] upstream media upload failed, falling back to text: ${error instanceof Error ? error.name : "unknown error"}`,
          );
          const fallbackContent = text
            ? `${text}\n⚠️ 媒体发送失败，请检查文件权限、格式或大小限制。`
            : "⚠️ 媒体发送失败，请检查文件权限、格式或大小限制。";
          return sendWeComMessage({
            to,
            content: fallbackContent,
            accountId: resolvedAccountId,
            cfg,
          });
        }
      }

      const channelPrefix = new RegExp(`^${CHANNEL_ID}:`, "i");
      const chatId = to.replace(channelPrefix, "");

      // 如果没有 mediaUrl，fallback 为纯文本
      if (!mediaUrl) {
        return sendWeComMessage({to, content: text || "", accountId: resolvedAccountId, cfg});
      }

      // ── 尝试 Bot WebSocket ──
      const wsClient = getWeComWebSocket(resolvedAccountId);
      if (wsClient?.isConnected) {
        const result = await uploadAndSendMedia({
          wsClient,
          mediaUrl,
          chatId,
          mediaLocalRoots,
        });

        if (result.rejected) {
          return sendWeComMessage({to, content: `⚠️ ${result.rejectReason}`, accountId: resolvedAccountId, cfg});
        }

        if (!result.ok) {
          const fallbackContent = text
            ? `${text}\n📎 ${mediaUrl}`
            : `📎 ${mediaUrl}`;
          return sendWeComMessage({to, content: fallbackContent, accountId: resolvedAccountId, cfg});
        }

        if (text) {
          await sendWeComMessage({to, content: text, accountId: resolvedAccountId, cfg});
        }
        if (result.downgradeNote) {
          await sendWeComMessage({to, content: `ℹ️ ${result.downgradeNote}`, accountId: resolvedAccountId, cfg});
        }

        return {
          channel: CHANNEL_ID,
          messageId: result.messageId!,
          chatId,
        };
      }

      // ── 回退到 Agent HTTP API ──
      if (!cfg) {
        throw new Error(`WSClient not connected for account ${resolvedAccountId} and no config available for Agent fallback`);
      }
      const account = resolveWeComAccountMulti({ cfg, accountId: resolvedAccountId });
      const agent = account.agent;
      if (!agent?.configured) {
        throw new Error(
          `WSClient not connected for account ${resolvedAccountId} and Agent mode is not configured. ` +
          `Please configure either Bot (botId + secret) or Agent (corpId + corpSecret + agentId).`
        );
      }

      // Agent 模式：文本 fallback（Agent HTTP API 不支持直接发 mediaUrl，需先上传）
      const target = resolveWecomTarget(chatId);
      if (!target) {
        throw new Error(`Cannot resolve outbound target from "${to}"`);
      }

      const startedAt = Date.now();
      const targetId = diagnosticFingerprint(JSON.stringify(target));
      console.log(
        `[wecom][outbound] account=${resolvedAccountId} stage=fallback_start from=bot_ws to=agent_http kind=media target=${targetId} media=${diagnosticFingerprint(mediaUrl)}`,
      );

      // 尝试下载并上传媒体到企微
      try {
        const media = await resolveAgentOutboundMedia(mediaUrl, mediaLocalRoots);
        const mediaId = await uploadAgentMedia({
          agent,
          type: media.mediaType,
          buffer: media.buffer,
          filename: media.fileName,
        });
        await sendAgentMedia({
          agent,
          toUser: target.touser,
          toParty: target.toparty,
          toTag: target.totag,
          chatId: target.chatid,
          mediaId,
          mediaType: media.mediaType,
          ...(media.mediaType === "video"
            ? { title: media.fileName, description: "" }
            : {}),
        });
        if (text) {
          await sendAgentText({ agent, toUser: target.touser, toParty: target.toparty, toTag: target.totag, chatId: target.chatid, text });
        }
        if (media.downgradeNote) {
          await sendAgentText({
            agent,
            toUser: target.touser,
            toParty: target.toparty,
            toTag: target.totag,
            chatId: target.chatid,
            text: `ℹ️ ${media.downgradeNote}`,
          });
        }
        console.log(
          `[wecom][outbound] account=${resolvedAccountId} stage=fallback_delivered transport=agent_http kind=media target=${targetId} mediaType=${media.mediaType} bytes=${media.buffer.length} durationMs=${Date.now() - startedAt}`,
        );
        return { channel: CHANNEL_ID, messageId: `agent-media-${Date.now()}`, chatId };
      } catch (err) {
        console.warn(
          `[wecom][outbound] account=${resolvedAccountId} stage=fallback_failed transport=agent_http kind=media target=${targetId} durationMs=${Date.now() - startedAt} ${formatDiagnosticError(err)}`,
        );
      }

      // 媒体上传失败，降级为文本 + URL
      const fallbackContent = text
        ? `${text}\n⚠️ 媒体发送失败，请检查文件权限、格式或大小限制。`
        : "⚠️ 媒体发送失败，请检查文件权限、格式或大小限制。";
      await sendAgentText({ agent, toUser: target.touser, toParty: target.toparty, toTag: target.totag, chatId: target.chatid, text: fallbackContent });
      console.log(
        `[wecom][outbound] account=${resolvedAccountId} stage=fallback_delivered transport=agent_http kind=text_after_media_failure target=${targetId} durationMs=${Date.now() - startedAt}`,
      );
      return { channel: CHANNEL_ID, messageId: `agent-${Date.now()}`, chatId };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lifecycle: "stopped",
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts): ChannelStatusIssue[] =>
      accounts.flatMap((entry) => {
        const accountId = String(entry.accountId ?? DEFAULT_ACCOUNT_ID);
        const enabled = entry.enabled !== false;
        const configured = entry.configured === true;
        if (!enabled) {
          return [];
        }
        const issues: ChannelStatusIssue[] = [];
        if (!configured) {
          issues.push({
            channel: CHANNEL_ID,
            accountId,
            kind: "config",
            message: "企业微信机器人 ID 或 Secret 未配置",
            fix: "Run: openclaw channels add wecom --bot-id <id> --secret <secret>",
          });
        }
        return issues;
      }),
    buildChannelSummary: ({snapshot}) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    probeAccount: async ({ account }) => {
      const transport = resolveWeComTransport(account);
      const ready = transport === "webhook"
        ? isWebhookGatewayRunning(account.accountId)
        : transport === "websocket"
          ? Boolean(getWeComWebSocket(account.accountId)?.isConnected)
          : transport === "agent";
      return { ok: ready, status: ready ? 200 : 503 };
    },
    buildAccountSnapshot: ({account, runtime}) => {
      const configured = isWeComAccountConfigured(account);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        running: runtime?.running ?? false,
        connected: runtime?.connected,
        lifecycle: runtime?.lifecycle ?? "stopped",
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      // OpenClaw resolves the account before handing it to the lifecycle owner.
      const account = ctx.account;

      // 读取连接模式（默认 websocket）
      const connectionMode = account.config.connectionMode ?? "websocket";
      const transport = resolveWeComTransport(account);
      const configDiagnostics = resolveWeComConfigDiagnostics({
        cfg: ctx.cfg,
        accountId: ctx.accountId,
      });

      ctx.log?.info(
        `starting wecom[${ctx.accountId}] (name: ${account.name}, mode: ${connectionMode})`,
      );
      ctx.log?.info(
        `[${ctx.accountId}] config resolved: transport=${transport} multiAccount=${hasMultiAccounts(ctx.cfg)} defaultAccount=${resolveDefaultWeComAccountId(ctx.cfg)} bot=${diagnosticFingerprint(account.botId)} botIdSource=${configDiagnostics.botIdSource} secretSource=${configDiagnostics.secretSource} agentConfigured=${Boolean(account.agent?.configured)} agentSecretSource=${configDiagnostics.agentSecretSource} compatibilityFields=${configDiagnostics.compatibilityFields.length ? configDiagnostics.compatibilityFields.join(",") : "none"}`,
      );

      // ── Agent target 注册 ──────────────────────────────────────────
      const agent = account.agent;
      if (agent?.configured) {
        const isMulti = hasMultiAccounts(ctx.cfg);
        const defaultId = resolveDefaultWeComAccountId(ctx.cfg);
        const isDefault = ctx.accountId === defaultId;
        const paths = isMulti
          ? [
              `${WEBHOOK_PATHS.AGENT_PLUGIN}/${ctx.accountId}`,
              `${WEBHOOK_PATHS.AGENT}/${ctx.accountId}`,
              // 默认账号额外注册 /default 别名路径
              ...(isDefault && ctx.accountId !== DEFAULT_ACCOUNT_ID
                ? [
                    `${WEBHOOK_PATHS.AGENT_PLUGIN}/${DEFAULT_ACCOUNT_ID}`,
                    `${WEBHOOK_PATHS.AGENT}/${DEFAULT_ACCOUNT_ID}`,
                  ]
                : []),
              WEBHOOK_PATHS.AGENT_PLUGIN,
              WEBHOOK_PATHS.AGENT,
            ]
          : [
              // 单账号模式：同时注册 /default 路径以支持显式指定
              WEBHOOK_PATHS.AGENT_PLUGIN,
              WEBHOOK_PATHS.AGENT,
              `${WEBHOOK_PATHS.AGENT_PLUGIN}/${DEFAULT_ACCOUNT_ID}`,
              `${WEBHOOK_PATHS.AGENT}/${DEFAULT_ACCOUNT_ID}`,
            ];

        for (const p of paths) {
          registerAgentWebhookTarget({
            agent,
            config: ctx.cfg,
            runtime: {
              log: ctx.log?.info ? (msg: string) => ctx.log!.info(msg) : undefined,
              error: ctx.log?.error ? (msg: string) => ctx.log!.error(msg) : undefined,
            },
            path: p,
          });
        }
        ctx.log?.info(`[${ctx.accountId}] wecom agent webhook registered at ${paths.join(", ")}`);

        // 账号生命周期结束时清理
        ctx.abortSignal.addEventListener("abort", () => {
          deregisterAgentWebhookTarget(agent.accountId);
        }, { once: true });
      }

      // ── Bot WebSocket 监听（需要 botId + secret）──────────────────
      if (transport === "websocket") {
        return monitorWeComProvider({
          account,
          config: ctx.cfg,
          runtime: ctx.runtime,
          abortSignal: ctx.abortSignal,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- SDK 类型签名在不同版本间存在差异
          setStatus: ctx.setStatus as any,
        });
      } else if (transport === "webhook") {
        // ── Webhook 模式 ──────────────────────────────────────────────
        const webhookAccount: ResolvedWebhookAccount = {
          ...account,
          connectionMode: "webhook",
          token: account.config.token ?? "",
          encodingAESKey: account.config.encodingAESKey ?? "",
          receiveId: account.config.receiveId ?? "",
          welcomeText: account.config.welcomeText,
        };

        const gatewayCtx: WebhookGatewayContext = {
          account: webhookAccount,
          config: ctx.cfg,
          runtime: ctx.runtime,
          abortSignal: ctx.abortSignal,
          setStatus: ctx.setStatus as any,
          log: ctx.log,
          accountId: ctx.accountId,
        };

        startWebhookGateway(gatewayCtx);

        // 等待 abortSignal 停止后清理
        await new Promise<void>((resolve) => {
          if (ctx.abortSignal.aborted) {
            stopWebhookGateway(gatewayCtx);
            resolve();
            return;
          }
          ctx.abortSignal.addEventListener("abort", () => {
            stopWebhookGateway(gatewayCtx);
            resolve();
          }, { once: true });
        });
        return;
      }

      if (transport === "unconfigured") {
        const message = connectionMode === "webhook"
          ? `WeCom account ${ctx.accountId} requires webhook token and encodingAESKey.`
          : `WeCom account ${ctx.accountId} requires WebSocket Bot ID and secret.`;
        ctx.setStatus({
          accountId: ctx.accountId,
          running: false,
          configured: false,
          lifecycle: "blocked",
          lastError: message,
        });
        throw new Error(message);
      }

      // Agent-only：无 Bot，等待 abort 信号
      return new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    logoutAccount: async ({cfg, accountId}) => {
      const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
      const isMulti = hasMultiAccounts(cfg);
      let nextCfg = {...cfg} as OpenClawConfig;
      let cleared = false;
      let changed = false;

      if (!isMulti) {
        // 单账号模式：删除顶层 botId/secret
        const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
        const nextWecom = {...wecomConfig};

        if (nextWecom.botId || nextWecom.secret) {
          delete nextWecom.botId;
          delete nextWecom.secret;
          cleared = true;
          changed = true;
        }

        if (changed) {
          if (Object.keys(nextWecom).length > 0) {
            nextCfg.channels = {...nextCfg.channels, [CHANNEL_ID]: nextWecom};
          } else {
            const nextChannels = {...nextCfg.channels};
            delete (nextChannels as Record<string, unknown>)[CHANNEL_ID];
            if (Object.keys(nextChannels).length > 0) {
              nextCfg.channels = nextChannels;
            } else {
              delete nextCfg.channels;
            }
          }
        }
      } else {
        // 多账号模式：删除指定账号的 botId/secret
        const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComMultiAccountConfig;
        const accountCfg = wecomConfig.accounts?.[resolvedAccountId];

        if (accountCfg?.botId || accountCfg?.secret) {
          const nextAccount = {...accountCfg};
          delete nextAccount.botId;
          delete nextAccount.secret;
          cleared = true;
          changed = true;

          const nextAccounts = { ...wecomConfig.accounts };
          if (Object.keys(nextAccount).length > 0) {
            nextAccounts[resolvedAccountId] = nextAccount;
          } else {
            delete nextAccounts[resolvedAccountId];
          }

          nextCfg = {
            ...cfg,
            channels: {
              ...cfg.channels,
              [CHANNEL_ID]: {
                ...wecomConfig,
                accounts: Object.keys(nextAccounts).length > 0 ? nextAccounts : undefined,
              },
            },
          } as OpenClawConfig;
        }
      }

      if (changed) {
        await getWeComRuntime().config.mutateConfigFile({
          base: "runtime",
          afterWrite: { mode: "auto" },
          mutate: (draft) => {
            for (const key of Object.keys(draft)) {
              delete (draft as Record<string, unknown>)[key];
            }
            Object.assign(draft, nextCfg);
          },
        });
      }

      const resolved = resolveWeComAccountMulti({ cfg: changed ? nextCfg : cfg, accountId: resolvedAccountId });
      const loggedOut = !resolved.botId && !resolved.secret;

      return {cleared, envToken: false, loggedOut};
    },
  },
};
