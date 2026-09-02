import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { resolveAccountEntry } from "openclaw/plugin-sdk/account-resolution";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { CHANNEL_ID } from "./const.js";
import type { WeComConfig, WeComAccountConfig, ResolvedWeComAccount } from "./utils.js";
import { DefaultWsUrl } from "./utils.js";
import type { ResolvedAgentAccount } from "./types/account.js";
import type { WecomAgentConfig } from "./types/config.js";

export type WeComConfigResolutionDiagnostics = {
  botIdSource: string;
  secretSource: string;
  agentSecretSource: string;
  compatibilityFields: string[];
};

// ============================================================================
// 多账号配置结构
// ============================================================================

/**
 * 企业微信多账号配置结构（扩展 WeComConfig）
 */
export interface WeComMultiAccountConfig extends WeComConfig {
  /** 默认账号 ID */
  defaultAccount?: string;
  /** 多账号配置 */
  accounts?: Record<string, WeComAccountConfig>;
}

type MergeableWeComConfig = WeComConfig & Record<string, unknown>;

const accountHelpers = createAccountListHelpers<MergeableWeComConfig>(CHANNEL_ID, {
  normalizeAccountId,
  omitKeys: ["defaultAccount"],
  nestedObjectKeys: ["groups"],
  implicitDefaultAccount: {
    channelKeys: ["botId", "secret", "token", "encodingAESKey", "agent"],
  },
});

// ============================================================================
// 账号列举
// ============================================================================

/**
 * 列出 accounts 字段中配置的所有账号 ID（已 normalize）。
 */
/**
 * 判断是否为多账号模式（即配置中存在 accounts 字段）。
 * 用于区分单账号/多账号模式的分支判断，替代 `accountId === DEFAULT_ACCOUNT_ID` 的不可靠判断。
 */
export function hasMultiAccounts(cfg: OpenClawConfig): boolean {
  return accountHelpers.listConfiguredAccountIds(cfg).length > 0;
}

/**
 * 列出所有企业微信账号 ID。
 * 如果没有 accounts 字段，返回 [DEFAULT_ACCOUNT_ID] 以向后兼容。
 */
export function listWeComAccountIds(cfg: OpenClawConfig): string[] {
  return accountHelpers.listAccountIds(cfg);
}

// ============================================================================
// 默认账号解析
// ============================================================================

/**
 * 解析默认账号 ID。
 *
 * 优先级：
 * 1. 显式设置的 defaultAccount
 * 2. 包含 DEFAULT_ACCOUNT_ID 的账号列表
 * 3. 字母序第一个账号
 */
export function resolveDefaultWeComAccountId(cfg: OpenClawConfig): string {
  return accountHelpers.resolveDefaultAccountId(cfg);
}

// ============================================================================
// 配置合并
// ============================================================================

/**
 * 合并顶层配置与账号级配置（账号级覆盖顶层）。
 *
 * 顶层字段（如 dmPolicy、allowFrom）作为所有账号的默认值，
 * accounts.xxx 中的字段会覆盖顶层的同名字段。
 * 对于 groups 等嵌套 Record 对象，使用深层合并（账号级条目覆盖同 key，但不丢失基础配置中的其他 key）。
 */
function mergeWeComAccountConfig(cfg: OpenClawConfig, accountId: string): WeComConfig {
  return accountHelpers.resolveAccountConfig(cfg, accountId);
}

function stringFieldSource(params: {
  account: WeComAccountConfig;
  root: WeComConfig;
  accountId: string;
  field: "botId" | "secret";
}): string {
  const { account, root, accountId, field } = params;
  if (typeof account[field] === "string") return `accounts.${accountId}.${field}`;
  if (accountId === DEFAULT_ACCOUNT_ID && typeof root[field] === "string") return field;
  return "missing";
}

/** Explain runtime credential selection without returning credential values. */
export function resolveWeComConfigDiagnostics(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): WeComConfigResolutionDiagnostics {
  const accountId = params.accountId?.trim()
    ? normalizeAccountId(params.accountId)
    : resolveDefaultWeComAccountId(params.cfg);
  const root = (params.cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig & {
    accounts?: Record<string, WeComAccountConfig>;
  };
  const account = (resolveAccountEntry(root.accounts, accountId) ?? {}) as WeComAccountConfig;
  const botIdSource = stringFieldSource({ account, root, accountId, field: "botId" });
  const secretSource = stringFieldSource({ account, root, accountId, field: "secret" });
  const agentSecretSource = typeof account.agent?.corpSecret === "string"
    ? `accounts.${accountId}.agent.corpSecret`
    : accountId === DEFAULT_ACCOUNT_ID && typeof root.agent?.corpSecret === "string"
        ? "agent.corpSecret"
        : "missing";

  return {
    botIdSource,
    secretSource,
    agentSecretSource,
    compatibilityFields: [],
  };
}

// ============================================================================
// 账号解析
// ============================================================================

/**
 * 解析单个企业微信账号的完整配置。
 *
 * 支持：
 * - 显式指定 accountId → 使用该 accountId
 * - 未指定 → 使用默认账号
 * - 单账号模式（无 accounts 字段） → 直接读取顶层配置
 */
export function resolveWeComAccountMulti(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedWeComAccount {
  const hasExplicitId = typeof params.accountId === "string" && params.accountId.trim() !== "";
  const accountId = hasExplicitId
    ? normalizeAccountId(params.accountId!)
    : resolveDefaultWeComAccountId(params.cfg);

  const wecomConfig = params.cfg.channels?.[CHANNEL_ID] as WeComMultiAccountConfig | undefined;
  const accountConfig = resolveAccountEntry(wecomConfig?.accounts, accountId) as
    | WeComAccountConfig
    | undefined;

  // 顶层 enabled 状态
  const baseEnabled = wecomConfig?.enabled !== false;

  // 合并配置
  const merged = mergeWeComAccountConfig(params.cfg, accountId);

  // 账号级 enabled 状态
  const accountEnabled = accountConfig?.enabled !== false;

  // Root credentials represent only the implicit `default` identity. Named accounts
  // must provide their own credentials or they could silently connect to the wrong bot.
  const credentials = accountId === DEFAULT_ACCOUNT_ID ? merged : (accountConfig ?? {});

  // 解析 Agent 子配置
  const agentCfg = credentials.agent as WecomAgentConfig | undefined;
  let agent: ResolvedAgentAccount | undefined;
  if (agentCfg?.corpId && agentCfg?.corpSecret && agentCfg?.token && agentCfg?.encodingAESKey) {
    agent = {
      accountId,
      enabled: baseEnabled && accountEnabled,
      configured: true,
      corpId: agentCfg.corpId,
      corpSecret: agentCfg.corpSecret,
      agentId: typeof agentCfg.agentId === "string" ? Number(agentCfg.agentId) || undefined : agentCfg.agentId,
      token: agentCfg.token,
      encodingAESKey: agentCfg.encodingAESKey,
      config: agentCfg,
      network: merged.network,
    };
  }

  return {
    accountId,
    name: merged.name ?? "企业微信",
    enabled: baseEnabled && accountEnabled,
    websocketUrl: merged.websocketUrl || DefaultWsUrl,
    botId: credentials.botId ?? "",
    secret: credentials.secret ?? "",
    sendThinkingMessage: merged.sendThinkingMessage ?? true,
    config: {
      ...merged,
      botId: credentials.botId,
      secret: credentials.secret,
      token: credentials.token,
      encodingAESKey: credentials.encodingAESKey,
      receiveId: credentials.receiveId,
      agent: agentCfg,
    },
    agent,
    token: credentials.token ?? "",
    encodingAESKey: credentials.encodingAESKey ?? "",
    receiveId: credentials.receiveId ?? "",
  };
}

// ============================================================================
// 批量查询
// ============================================================================

/**
 * 列出所有已启用且已配置凭据的账号。
 */
export function listEnabledWeComAccounts(cfg: OpenClawConfig): ResolvedWeComAccount[] {
  return listWeComAccountIds(cfg)
    .map((accountId) => resolveWeComAccountMulti({ cfg, accountId }))
    .filter((account) => {
      if (!account.enabled) return false;
      const hasBotCredentials = Boolean(account.botId?.trim() && account.secret?.trim());
      const hasWebhookCredentials = Boolean(
        account.token?.trim() && account.encodingAESKey?.trim(),
      );
      const hasAgentCredentials = Boolean(account.agent?.configured);
      return hasBotCredentials || hasWebhookCredentials || hasAgentCredentials;
    });
}

// ============================================================================
// 配置写入（多账号感知）
// ============================================================================

/**
 * 写入企业微信账户配置（自动区分单账号/多账号模式）。
 *
 * - 单账号模式（无 accounts 字段）：写入顶层 channels.wecom
 * - 多账号模式：写入 channels.wecom.accounts[accountId]
 *
 * @param cfg  当前全局配置
 * @param updates  要写入的部分配置字段
 * @param accountId  目标账号 ID（默认写入默认账号）
 */
export function setWeComAccountMulti(
  cfg: OpenClawConfig,
  updates: Partial<WeComConfig>,
  accountId?: string,
): OpenClawConfig {
  const resolvedAccountId = accountId ?? resolveDefaultWeComAccountId(cfg);
  const isMulti = hasMultiAccounts(cfg);

  if (!isMulti) {
    // 单账号模式：合并到顶层
    const existing = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
    const merged: WeComConfig = { ...existing, ...updates };
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        [CHANNEL_ID]: merged,
      },
    };
  }

  // 多账号模式：合并到 accounts[accountId]
  const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComMultiAccountConfig;
  const existingAccount = wecomConfig.accounts?.[resolvedAccountId] ?? {};
  const mergedAccount: WeComAccountConfig = { ...existingAccount, ...updates };

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [CHANNEL_ID]: {
        ...wecomConfig,
        accounts: {
          ...wecomConfig.accounts,
          [resolvedAccountId]: mergedAccount,
        },
      },
    },
  };
}
