import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import { createScopedChannelConfigAdapter } from "openclaw/plugin-sdk/channel-config-helpers";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { ResolvedWeComAccount } from "./utils.js";
import {
  listWeComAccountIds,
  resolveDefaultWeComAccountId,
  resolveWeComAccountMulti,
  resolveWeComConfigDiagnostics,
} from "./accounts.js";
import { CHANNEL_ID } from "./const.js";

export function isWeComAccountConfigured(account: ResolvedWeComAccount): boolean {
  return resolveWeComTransport(account) !== "unconfigured";
}

export type WeComTransport = "websocket" | "webhook" | "agent" | "unconfigured";

/** Resolve the single Bot transport selected by the account's canonical config. */
export function resolveWeComTransport(account: ResolvedWeComAccount): WeComTransport {
  const mode = account.config.connectionMode ?? "websocket";
  if (mode === "webhook" && account.token?.trim() && account.encodingAESKey?.trim()) {
    return "webhook";
  }
  if (mode === "websocket" && account.botId.trim() && account.secret.trim()) {
    return "websocket";
  }
  if (account.agent?.configured) {
    return "agent";
  }
  return "unconfigured";
}

const scopedConfig = createScopedChannelConfigAdapter<ResolvedWeComAccount>({
  sectionKey: CHANNEL_ID,
  listAccountIds: listWeComAccountIds,
  resolveAccount: (cfg, accountId) => resolveWeComAccountMulti({ cfg, accountId }),
  inspectAccount: (cfg, accountId) => {
    const account = resolveWeComAccountMulti({ cfg, accountId });
    const sources = resolveWeComConfigDiagnostics({ cfg, accountId });
    return {
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: isWeComAccountConfigured(account),
      connectionMode: account.config.connectionMode ?? "websocket",
      activeTransport: resolveWeComTransport(account),
      botCredentials: account.botId && account.secret ? "configured" : "missing",
      webhookCredentials:
        account.token && account.encodingAESKey ? "configured" : "missing",
      agentCredentials: account.agent?.configured ? "configured" : "missing",
      credentialSources: sources,
    };
  },
  defaultAccountId: resolveDefaultWeComAccountId,
  clearBaseFields: [
    "name",
    "connectionMode",
    "websocketUrl",
    "botId",
    "secret",
    "token",
    "encodingAESKey",
    "receiveId",
    "dmPolicy",
    "allowFrom",
    "groupPolicy",
    "groupAllowFrom",
    "groups",
    "agent",
    "network",
    "media",
    "dynamicAgents",
    "cli",
    "sendThinkingMessage",
    "mediaLocalRoots",
    "welcomeText",
    "streamPlaceholderContent",
  ],
  resolveAllowFrom: (account) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) =>
    allowFrom.map((entry) => String(entry).trim()).filter(Boolean),
});

export const wecomConfigAdapter: ChannelPlugin<ResolvedWeComAccount>["config"] = {
  ...scopedConfig,
  isEnabled: (account) => account.enabled,
  isConfigured: isWeComAccountConfigured,
  describeAccount: (account) =>
    describeAccountSnapshot({
      account,
      configured: isWeComAccountConfigured(account),
      extra: {
        mode: account.config.connectionMode ?? "websocket",
        activeTransport: resolveWeComTransport(account),
        botConfigured: Boolean(account.botId && account.secret),
        webhookConfigured: Boolean(account.token && account.encodingAESKey),
        agentConfigured: Boolean(account.agent?.configured),
      },
    }),
};
