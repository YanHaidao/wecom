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

export type WecomAccountConflict = {
    type: "duplicate_bot_token" | "duplicate_bot_aibotid" | "duplicate_agent_id";
    accountId: string;
    ownerAccountId: string;
    message: string;
};

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

function normalizeDuplicateKey(value: string): string {
    return value.trim().toLowerCase();
}

function formatBotTokenConflict(params: { accountId: string; ownerAccountId: string }): WecomAccountConflict {
    return {
        type: "duplicate_bot_token",
        accountId: params.accountId,
        ownerAccountId: params.ownerAccountId,
        message:
            `Duplicate WeCom bot token: account "${params.accountId}" shares a token with account "${params.ownerAccountId}". ` +
            "Keep one owner account per bot token.",
    };
}

function formatBotAibotidConflict(params: { accountId: string; ownerAccountId: string }): WecomAccountConflict {
    return {
        type: "duplicate_bot_aibotid",
        accountId: params.accountId,
        ownerAccountId: params.ownerAccountId,
        message:
            `Duplicate WeCom bot aibotid: account "${params.accountId}" shares aibotid with account "${params.ownerAccountId}". ` +
            "Keep one owner account per aibotid.",
    };
}

function formatAgentIdConflict(params: { accountId: string; ownerAccountId: string; corpId: string; agentId: number }): WecomAccountConflict {
    return {
        type: "duplicate_agent_id",
        accountId: params.accountId,
        ownerAccountId: params.ownerAccountId,
        message:
            `Duplicate WeCom agent identity: account "${params.accountId}" shares corpId/agentId (${params.corpId}/${params.agentId}) with account "${params.ownerAccountId}". ` +
            "Keep one owner account per corpId/agentId pair.",
    };
}

function collectWecomAccountConflicts(cfg: OpenClawConfig): Map<string, WecomAccountConflict> {
    const resolved = resolveWecomAccounts(cfg);
    const conflicts = new Map<string, WecomAccountConflict>();
    const botTokenOwners = new Map<string, string>();
    const botAibotidOwners = new Map<string, string>();
    const agentOwners = new Map<string, string>();

    const accountIds = Object.keys(resolved.accounts).sort((a, b) => a.localeCompare(b));
    for (const accountId of accountIds) {
        const account = resolved.accounts[accountId];
        if (!account || account.enabled === false) {
            continue;
        }
        const bot = account.bot;
        const agent = account.agent;

        const botToken = bot?.token?.trim();
        if (botToken) {
            const key = normalizeDuplicateKey(botToken);
            const owner = botTokenOwners.get(key);
            if (owner && owner !== accountId) {
                conflicts.set(accountId, formatBotTokenConflict({ accountId, ownerAccountId: owner }));
            } else {
                botTokenOwners.set(key, accountId);
            }
        }

        const botAibotid = bot?.config.aibotid?.trim();
        if (botAibotid) {
            const key = normalizeDuplicateKey(botAibotid);
            const owner = botAibotidOwners.get(key);
            if (owner && owner !== accountId) {
                conflicts.set(accountId, formatBotAibotidConflict({ accountId, ownerAccountId: owner }));
            } else {
                botAibotidOwners.set(key, accountId);
            }
        }

        const corpId = agent?.corpId?.trim();
        const agentId = agent?.agentId;
        if (corpId && typeof agentId === "number" && Number.isFinite(agentId)) {
            const key = `${normalizeDuplicateKey(corpId)}:${agentId}`;
            const owner = agentOwners.get(key);
            if (owner && owner !== accountId) {
                conflicts.set(accountId, formatAgentIdConflict({ accountId, ownerAccountId: owner, corpId, agentId }));
            } else {
                agentOwners.set(key, accountId);
            }
        }
    }

    return conflicts;
}

export function resolveWecomAccountConflict(params: {
    cfg: OpenClawConfig;
    accountId: string;
}): WecomAccountConflict | undefined {
    return collectWecomAccountConflicts(params.cfg).get(params.accountId);
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
    if (requestedId) {
        return (
            resolved.accounts[requestedId] ??
            toResolvedAccount({
                accountId: requestedId,
                enabled: false,
                config: {},
            })
        );
    }
    return (
        resolved.accounts[fallbackId] ??
        resolved.accounts[DEFAULT_ACCOUNT_ID] ??
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
