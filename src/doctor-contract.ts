import type {
  ChannelDoctorConfigMutation,
  ChannelDoctorLegacyConfigRule,
} from "openclaw/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { asNullableRecord as asObjectRecord } from "openclaw/plugin-sdk/string-coerce-runtime";

function hasLegacyBotShape(value: unknown): boolean {
  return asObjectRecord(value)?.bot !== undefined;
}

function hasLegacyAgentShape(value: unknown): boolean {
  const agent = asObjectRecord(asObjectRecord(value)?.agent);
  return Boolean(agent && (agent.agentSecret !== undefined || agent.dm !== undefined));
}

function hasLegacyAccountEntry(value: unknown): boolean {
  const entry = asObjectRecord(value);
  if (!entry) return false;
  if (hasLegacyBotShape(entry) || hasLegacyAgentShape(entry)) return true;
  const accounts = asObjectRecord(entry.accounts);
  return Boolean(
    accounts && Object.values(accounts).some((account) =>
      hasLegacyBotShape(account) || hasLegacyAgentShape(account)),
  );
}

export const legacyConfigRules: ChannelDoctorLegacyConfigRule[] = [
  {
    path: ["channels", "wecom"],
    message:
      'channels.wecom contains the pre-official Bot/Agent nesting. Run "openclaw doctor --fix" to migrate it to the official flat Bot account shape.',
    match: hasLegacyAccountEntry,
  },
];

function copyWhenMissing(
  target: Record<string, unknown>,
  targetKey: string,
  value: unknown,
): void {
  if (target[targetKey] === undefined && value !== undefined) {
    target[targetKey] = value;
  }
}

function normalizeLegacyWecomEntry(params: {
  entry: Record<string, unknown>;
  pathPrefix: string;
  changes: string[];
}): { entry: Record<string, unknown>; changed: boolean } {
  const bot = asObjectRecord(params.entry.bot);
  const rawAgent = asObjectRecord(params.entry.agent);
  if (!bot && !hasLegacyAgentShape(params.entry)) {
    return { entry: params.entry, changed: false };
  }

  const next = { ...params.entry };
  if (bot) {
    const ws = asObjectRecord(bot.ws);
    const webhook = asObjectRecord(bot.webhook);
    copyWhenMissing(
      next,
      "connectionMode",
      bot.primaryTransport === "ws"
        ? "websocket"
        : bot.primaryTransport === "webhook"
          ? "webhook"
          : undefined,
    );
    copyWhenMissing(next, "botId", ws?.botId);
    copyWhenMissing(next, "secret", ws?.secret);
    copyWhenMissing(next, "token", webhook?.token ?? bot.token);
    copyWhenMissing(next, "encodingAESKey", webhook?.encodingAESKey ?? bot.encodingAESKey);
    copyWhenMissing(next, "receiveId", webhook?.receiveId);
    copyWhenMissing(next, "streamPlaceholderContent", bot.streamPlaceholderContent);
    copyWhenMissing(next, "welcomeText", bot.welcomeText);
    const dm = asObjectRecord(bot.dm);
    copyWhenMissing(next, "dmPolicy", dm?.policy);
    copyWhenMissing(next, "allowFrom", dm?.allowFrom);
    delete next.bot;
    params.changes.push(
      `Migrated ${params.pathPrefix}.bot to the official flat WeCom Bot account fields.`,
    );
  }

  if (rawAgent && (rawAgent.agentSecret !== undefined || rawAgent.dm !== undefined)) {
    const agent = { ...rawAgent };
    copyWhenMissing(agent, "corpSecret", agent.agentSecret);
    const dm = asObjectRecord(agent.dm);
    copyWhenMissing(agent, "dmPolicy", dm?.policy);
    copyWhenMissing(agent, "allowFrom", dm?.allowFrom);
    delete agent.agentSecret;
    delete agent.dm;
    next.agent = agent;
    params.changes.push(
      `Migrated ${params.pathPrefix}.agent legacy secret and DM fields.`,
    );
  }

  return { entry: next, changed: true };
}

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: OpenClawConfig;
}): ChannelDoctorConfigMutation {
  const channels = asObjectRecord(cfg.channels);
  const channel = asObjectRecord(channels?.wecom);
  const changes: string[] = [];
  if (!channel) {
    return { config: cfg, changes };
  }

  const root = normalizeLegacyWecomEntry({
    entry: channel,
    pathPrefix: "channels.wecom",
    changes,
  });
  const rawAccounts = asObjectRecord(root.entry.accounts);
  let accountsChanged = false;
  let accounts = rawAccounts;
  if (rawAccounts) {
    accounts = { ...rawAccounts };
    for (const [accountId, value] of Object.entries(rawAccounts)) {
      const account = asObjectRecord(value);
      if (!account) continue;
      const normalized = normalizeLegacyWecomEntry({
        entry: account,
        pathPrefix: `channels.wecom.accounts.${accountId}`,
        changes,
      });
      if (normalized.changed) {
        accounts[accountId] = normalized.entry;
        accountsChanged = true;
      }
    }
  }

  if (!root.changed && !accountsChanged) {
    return { config: cfg, changes };
  }
  const nextChannel = accountsChanged ? { ...root.entry, accounts } : root.entry;
  return {
    config: {
      ...cfg,
      channels: { ...channels, wecom: nextChannel },
    } as OpenClawConfig,
    changes,
  };
}
