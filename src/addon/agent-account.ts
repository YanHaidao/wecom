import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";

type JsonRecord = Record<string, unknown>;

export type WecomAddonNetworkConfig = {
  egressProxyUrl?: string;
};

export type WecomAddonAgentConfig = {
  corpId: string;
  corpSecret?: string;
  agentSecret?: string;
  agentId?: number | string;
  upstreamCorps?: Record<string, { corpId: string; agentId: number | string }>;
};

export type WecomAddonAgentAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  corpId: string;
  corpSecret: string;
  agentId?: number;
  config: WecomAddonAgentConfig;
  network?: WecomAddonNetworkConfig;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function normalizeAccountId(value: string): string {
  return value.trim().toLowerCase() || "default";
}

function wecomConfig(cfg: OpenClawConfig): JsonRecord {
  const channels = asRecord((cfg as unknown as JsonRecord).channels);
  return asRecord(channels.wecom);
}

function accountEntries(cfg: OpenClawConfig): Array<[string, JsonRecord]> {
  const accounts = asRecord(wecomConfig(cfg).accounts);
  return Object.entries(accounts)
    .filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]))
    .map(([accountId, account]) => [normalizeAccountId(accountId), account]);
}

export function listWecomAddonAccountIds(cfg: OpenClawConfig): string[] {
  const accountIds = accountEntries(cfg).map(([accountId]) => accountId);
  return accountIds.length > 0 ? [...new Set(accountIds)].sort() : ["default"];
}

export function resolveDefaultWecomAddonAccountId(cfg: OpenClawConfig): string {
  const config = wecomConfig(cfg);
  const preferred =
    typeof config.defaultAccount === "string"
      ? normalizeAccountId(config.defaultAccount)
      : undefined;
  const accountIds = listWecomAddonAccountIds(cfg);
  if (preferred && accountIds.includes(preferred)) {
    return preferred;
  }
  return accountIds.includes("default") ? "default" : (accountIds[0] ?? "default");
}

function resolveAccountConfig(cfg: OpenClawConfig, accountId: string): JsonRecord {
  const base = wecomConfig(cfg);
  const account = accountEntries(cfg).find(([id]) => id === normalizeAccountId(accountId))?.[1];
  return account ? { ...base, ...account } : base;
}

function toAgentId(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveNetwork(config: JsonRecord): WecomAddonNetworkConfig | undefined {
  const network = asRecord(config.network);
  const egressProxyUrl =
    typeof network.egressProxyUrl === "string" ? network.egressProxyUrl.trim() : "";
  return egressProxyUrl ? { egressProxyUrl } : undefined;
}

/** Resolve only the Agent API credentials used by enhanced tools; Channel state stays separate. */
export function resolveAddonAgentAccount(
  cfg: OpenClawConfig,
  accountId: string,
): WecomAddonAgentAccount | undefined {
  const root = wecomConfig(cfg);
  const account = resolveAccountConfig(cfg, accountId);
  const agent = asRecord(account.agent);
  const corpId = typeof agent.corpId === "string" ? agent.corpId.trim() : "";
  const corpSecret =
    (typeof agent.corpSecret === "string" ? agent.corpSecret.trim() : "") ||
    (typeof agent.agentSecret === "string" ? agent.agentSecret.trim() : "");
  const agentId = toAgentId(agent.agentId);
  if (!corpId && !corpSecret && agentId === undefined) {
    return undefined;
  }

  const config: WecomAddonAgentConfig = {
    corpId,
    ...(typeof agent.corpSecret === "string" ? { corpSecret: agent.corpSecret } : {}),
    ...(typeof agent.agentSecret === "string" ? { agentSecret: agent.agentSecret } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
    ...(isRecord(agent.upstreamCorps)
      ? { upstreamCorps: agent.upstreamCorps as WecomAddonAgentConfig["upstreamCorps"] }
      : {}),
  };
  const enabled = root.enabled !== false && account.enabled !== false;
  return {
    accountId: normalizeAccountId(accountId),
    enabled,
    configured: enabled && Boolean(corpId && corpSecret && agentId !== undefined),
    corpId,
    corpSecret,
    agentId,
    config,
    network: resolveNetwork(account),
  };
}

export function resolveAddonEgressProxyUrl(
  network: WecomAddonNetworkConfig | undefined,
): string | undefined {
  const value = network?.egressProxyUrl?.trim();
  return value || undefined;
}
