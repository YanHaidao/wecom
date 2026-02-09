import type {
  ChannelAccountSnapshot,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";

import {
  DEFAULT_ACCOUNT_ID,
  detectMode,
  listWecomAccountIds,
  resolveDefaultWecomAccountId,
  resolveWecomAccount,
} from "./config/index.js";
import type { ResolvedWecomAccount } from "./types/index.js";
import { registerAgentWebhookTarget, registerWecomWebhookTarget } from "./monitor.js";
import { wecomOnboardingAdapter } from "./onboarding.js";
import { wecomOutbound } from "./outbound.js";

const meta = {
  id: "wecom",
  label: "WeCom",
  selectionLabel: "WeCom (plugin)",
  docsPath: "/channels/wecom",
  docsLabel: "wecom",
  blurb: "Enterprise WeCom intelligent bot (API mode) via encrypted webhooks + passive replies.",
  aliases: ["wechatwork", "wework", "qywx", "企微", "企业微信"],
  order: 85,
  quickstartAllowFrom: true,
};

function normalizeWecomMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^(wecom-agent|wecom|wechatwork|wework|qywx):/i, "").trim() || undefined;
}

export const wecomPlugin: ChannelPlugin<ResolvedWecomAccount> = {
  id: "wecom",
  meta,
  onboarding: wecomOnboardingAdapter,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.wecom"] },
  // NOTE: We intentionally avoid Zod -> JSON Schema conversion at plugin-load time.
  // Some OpenClaw runtime environments load plugin modules via jiti in a way that can
  // surface zod `toJSONSchema()` binding issues (e.g. `this` undefined leading to `_zod` errors).
  // A permissive schema keeps config UX working while preventing startup failures.
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: true,
      properties: {},
    },
  },
  config: {
    listAccountIds: (cfg) => listWecomAccountIds(cfg as OpenClawConfig),
    resolveAccount: (cfg, accountId) => resolveWecomAccount({ cfg: cfg as OpenClawConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultWecomAccountId(cfg as OpenClawConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as OpenClawConfig,
        sectionKey: "wecom",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg }) => {
      const next = { ...(cfg as OpenClawConfig) };
      if (next.channels?.wecom) {
        const channels = { ...(next.channels ?? {}) } as Record<string, unknown>;
        delete (channels as Record<string, unknown>).wecom;
        return { ...next, channels } as OpenClawConfig;
      }
      return next;
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account): ChannelAccountSnapshot => {
      const matrixMode = account.accountId !== DEFAULT_ACCOUNT_ID;
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        webhookPath: account.bot?.config
          ? (matrixMode ? `/wecom/bot/${account.accountId}` : "/wecom/bot")
          : account.agent?.config
            ? (matrixMode ? `/wecom/agent/${account.accountId}` : "/wecom/agent")
            : "/wecom",
      };
    },
    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveWecomAccount({ cfg: cfg as OpenClawConfig, accountId });
      // 与其他渠道保持一致：直接返回 allowFrom，空则允许所有人
      const allowFrom = account.agent?.config.dm?.allowFrom ?? account.bot?.config.dm?.allowFrom ?? [];
      return allowFrom.map((entry) => String(entry));
    },
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  // security 配置在 WeCom 中不需要，框架会通过 resolveAllowFrom 自动判断
  groups: {
    // WeCom bots are usually mention-gated by the platform in groups already.
    resolveRequireMention: () => true,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  messaging: {
    normalizeTarget: normalizeWecomMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => Boolean(raw.trim()),
      hint: "<userid|chatid>",
    },
  },
  outbound: {
    ...wecomOutbound,
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      webhookPath: snapshot.webhookPath ?? null,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      lastInboundAt: snapshot.lastInboundAt ?? null,
      lastOutboundAt: snapshot.lastOutboundAt ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async () => ({ ok: true }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      webhookPath: account.bot?.config
        ? (account.accountId === DEFAULT_ACCOUNT_ID ? "/wecom/bot" : `/wecom/bot/${account.accountId}`)
        : account.agent?.config
          ? (account.accountId === DEFAULT_ACCOUNT_ID ? "/wecom/agent" : `/wecom/agent/${account.accountId}`)
          : "/wecom",
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      dmPolicy: account.bot?.config.dm?.policy ?? "pairing",
    }),
  },
  gateway: {
    /**
     * **startAccount (启动账号)**
     * 
     * 插件生命周期：启动
     * 职责：
     * 1. 检查配置是否有效。
     * 2. 注册 Bot Webhook (`/wecom`, `/wecom/bot`)。
     * 3. 注册 Agent Webhook (`/wecom/agent`)。
     * 4. 更新运行时状态 (Running)。
     * 5. 返回停止回调 (Cleanup)。
     */
    startAccount: async (ctx) => {
      const account = ctx.account;
      const mode = detectMode((ctx.cfg as OpenClawConfig).channels?.wecom as any);
      const matrixMode = mode === "matrix";
      const bot = account.bot;
      const agent = account.agent;
      const botConfigured = Boolean(bot?.configured);
      const agentConfigured = Boolean(agent?.configured);

      if (!botConfigured && !agentConfigured) {
        ctx.log?.warn(`[${account.accountId}] wecom not configured; skipping webhook registration`);
        ctx.setStatus({ accountId: account.accountId, running: false, configured: false });
        return { stop: () => { } };
      }

      const unregisters: Array<() => void> = [];
      if (bot && botConfigured) {
        const paths = matrixMode
          ? [`/wecom/bot/${account.accountId}`]
          : ["/wecom", "/wecom/bot"];
        for (const path of paths) {
          unregisters.push(
            registerWecomWebhookTarget({
              account: bot,
              config: ctx.cfg as OpenClawConfig,
              runtime: ctx.runtime,
              // The HTTP handler resolves the active PluginRuntime via getWecomRuntime().
              // The stored target only needs to be decrypt/verify-capable.
              core: ({} as unknown) as any,
              path,
              statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
            }),
          );
        }
        ctx.log?.info(`[${account.accountId}] wecom bot webhook registered at ${paths.join(", ")}`);
      }
      if (agent && agentConfigured) {
        const path = matrixMode ? `/wecom/agent/${account.accountId}` : "/wecom/agent";
        unregisters.push(
          registerAgentWebhookTarget({
            agent,
            config: ctx.cfg as OpenClawConfig,
            runtime: ctx.runtime,
            path,
          }),
        );
        ctx.log?.info(`[${account.accountId}] wecom agent webhook registered at ${path}`);
      }

      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        configured: true,
        webhookPath: botConfigured
          ? (matrixMode ? `/wecom/bot/${account.accountId}` : "/wecom/bot")
          : (matrixMode ? `/wecom/agent/${account.accountId}` : "/wecom/agent"),
        lastStartAt: Date.now(),
      });
      return {
        stop: () => {
          for (const unregister of unregisters) {
            unregister();
          }
          ctx.setStatus({
            accountId: account.accountId,
            running: false,
            lastStopAt: Date.now(),
          });
        },
      };
    },
    stopAccount: async (ctx) => {
      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: false,
        lastStopAt: Date.now(),
      });
    },
  },
};
