/**
 * WeCom 账号解析与模式检测
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type {
    WecomConfig,
    WecomAccountConfig,
    WecomBotConfig,
    WecomAgentConfig,
    WecomNetworkConfig,
    ResolvedWecomAccount,
    ResolvedBotAccount,
    ResolvedAgentAccount,
    ResolvedMode,
    ResolvedWecomAccounts,
} from "../types/index.js";

export const DEFAULT_ACCOUNT_ID = "default";

/**
 * 检测配置中启用的模式
 */
export function detectMode(config: WecomConfig | undefined): ResolvedMode {
    if (!config || config.enabled === false) return "disabled";

    const accounts = config.accounts;
    if (accounts && typeof accounts === "object") {
        const enabledEntries = Object.values(accounts).filter(
            (entry) => entry && entry.enabled !== false,
        );
        if (enabledEntries.length > 0) return "matrix";
    }

    return "legacy";
}

/**
 * 解析 Bot 模式账号
 */
function resolveBotAccount(accountId: string, config: WecomBotConfig, network?: WecomNetworkConfig): ResolvedBotAccount {
    return {
        accountId,
        enabled: true,
        configured: Boolean(config.token && config.encodingAESKey),
        token: config.token,
        encodingAESKey: config.encodingAESKey,
        receiveId: config.receiveId?.trim() ?? "",
        config,
        network,
    };
}

/**
 * 解析 Agent 模式账号
 */
function resolveAgentAccount(accountId: string, config: WecomAgentConfig, network?: WecomNetworkConfig): ResolvedAgentAccount {
    const agentIdRaw = config.agentId;
    const agentId = agentIdRaw == null
        ? undefined
        : (typeof agentIdRaw === "number" ? agentIdRaw : Number(agentIdRaw));
    const normalizedAgentId = Number.isFinite(agentId) ? agentId : undefined;

    return {
        accountId,
        enabled: true,
        configured: Boolean(
            config.corpId && config.corpSecret &&
            config.token && config.encodingAESKey
        ),
        corpId: config.corpId,
        corpSecret: config.corpSecret,
        agentId: normalizedAgentId,
        token: config.token,
        encodingAESKey: config.encodingAESKey,
        config,
        network,
    };
}

function toResolvedAccount(params: {
    accountId: string;
    enabled: boolean;
    name?: string;
    config: WecomAccountConfig;
    network?: WecomNetworkConfig;
}): ResolvedWecomAccount {
    const bot = params.config.bot
        ? resolveBotAccount(params.accountId, params.config.bot, params.network)
        : undefined;
    const agent = params.config.agent
        ? resolveAgentAccount(params.accountId, params.config.agent, params.network)
        : undefined;
    const configured = Boolean(bot?.configured || agent?.configured);
    return {
        accountId: params.accountId,
        name: params.name,
        enabled: params.enabled,
        configured,
        config: params.config,
        bot,
        agent,
    };
}

function resolveMatrixAccounts(wecom: WecomConfig): Record<string, ResolvedWecomAccount> {
    const accounts = wecom.accounts;
    if (!accounts || typeof accounts !== "object") return {};

    const resolved: Record<string, ResolvedWecomAccount> = {};
    for (const [rawId, entry] of Object.entries(accounts)) {
        const accountId = rawId.trim();
        if (!accountId || !entry) continue;
        const enabled = wecom.enabled !== false && entry.enabled !== false;
        const config: WecomAccountConfig = {
            enabled: entry.enabled,
            name: entry.name,
            bot: entry.bot,
            agent: entry.agent,
        };
        resolved[accountId] = toResolvedAccount({
            accountId,
            enabled,
            name: entry.name,
            config,
            network: wecom.network,
        });
    }
    return resolved;
}

function resolveLegacyAccounts(wecom: WecomConfig): Record<string, ResolvedWecomAccount> {
    const config: WecomAccountConfig = {
        bot: wecom.bot,
        agent: wecom.agent,
    };
    const account = toResolvedAccount({
        accountId: DEFAULT_ACCOUNT_ID,
        enabled: wecom.enabled !== false,
        config,
        network: wecom.network,
    });
    return { [DEFAULT_ACCOUNT_ID]: account };
}

export function listWecomAccountIds(cfg: OpenClawConfig): string[] {
    const wecom = cfg.channels?.wecom as WecomConfig | undefined;
    const mode = detectMode(wecom);
    if (mode === "matrix" && wecom?.accounts) {
        const ids = Object.keys(wecom.accounts)
            .map((id) => id.trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        if (ids.length > 0) return ids;
    }
    return [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultWecomAccountId(cfg: OpenClawConfig): string {
    const wecom = cfg.channels?.wecom as WecomConfig | undefined;
    const ids = listWecomAccountIds(cfg);
    const preferred = wecom?.defaultAccount?.trim();
    if (preferred && ids.includes(preferred)) return preferred;
    return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function resolveWecomAccount(params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
}): ResolvedWecomAccount {
    const resolved = resolveWecomAccounts(params.cfg);
    const fallbackId = resolved.defaultAccountId;
    const requestedId = params.accountId?.trim();
    const accountId = requestedId || fallbackId;
    return (
        resolved.accounts[accountId] ??
        resolved.accounts[fallbackId] ??
        toResolvedAccount({
            accountId: fallbackId,
            enabled: false,
            config: {},
        })
    );
}

/**
 * 解析 WeCom 账号 (双模式)
 */
export function resolveWecomAccounts(cfg: OpenClawConfig): ResolvedWecomAccounts {
    const wecom = cfg.channels?.wecom as WecomConfig | undefined;

    if (!wecom || wecom.enabled === false) {
        return {
            mode: "disabled",
            defaultAccountId: DEFAULT_ACCOUNT_ID,
            accounts: {},
        };
    }

    const mode = detectMode(wecom);
    const accounts = mode === "matrix" ? resolveMatrixAccounts(wecom) : resolveLegacyAccounts(wecom);
    const defaultAccountId = resolveDefaultWecomAccountId(cfg);
    const defaultAccount = accounts[defaultAccountId] ?? accounts[DEFAULT_ACCOUNT_ID];

    return {
        mode,
        defaultAccountId,
        accounts,
        bot: defaultAccount?.bot,
        agent: defaultAccount?.agent,
    };
}

/**
 * 检查是否有任何模式启用
 */
export function isWecomEnabled(cfg: OpenClawConfig): boolean {
    const resolved = resolveWecomAccounts(cfg);
    return Object.values(resolved.accounts).some((account) => account.configured && account.enabled);
}
