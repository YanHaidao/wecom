/**
 * WeCom 账号类型定义
 */

import type {
    WecomBotConfig,
    WecomAgentConfig,
    WecomDmConfig,
    WecomNetworkConfig,
    WecomAccountConfig,
} from "./config.js";

/**
 * 解析后的 Bot 账号
 */
export type ResolvedBotAccount = {
    /** 账号 ID */
    accountId: string;
    /** 是否启用 */
    enabled: boolean;
    /** 是否配置完整 */
    configured: boolean;
    /** 回调 Token */
    token: string;
    /** 回调加密密钥 */
    encodingAESKey: string;
    /** 接收者 ID */
    receiveId: string;
    /** 原始配置 */
    config: WecomBotConfig;
    /** 网络配置（来自 channels.wecom.network） */
    network?: WecomNetworkConfig;
};

/**
 * 解析后的 Agent 账号
 */
export type ResolvedAgentAccount = {
    /** 账号 ID */
    accountId: string;
    /** 是否启用 */
    enabled: boolean;
    /** 是否配置完整 */
    configured: boolean;
    /** 企业 ID */
    corpId: string;
    /** 应用 Secret */
    corpSecret: string;
    /** 应用 ID (数字，可选) */
    agentId?: number;
    /** 回调 Token */
    token: string;
    /** 回调加密密钥 */
    encodingAESKey: string;
    /** 原始配置 */
    config: WecomAgentConfig;
    /** 网络配置（来自 channels.wecom.network） */
    network?: WecomNetworkConfig;
};

/** Matrix/Legacy 的统一账号解析结果 */
export type ResolvedWecomAccount = {
    /** 账号 ID（用于 bindings.match.accountId） */
    accountId: string;
    /** 展示名称 */
    name?: string;
    /** 是否启用 */
    enabled: boolean;
    /** 是否具备至少一种可用能力（bot/agent） */
    configured: boolean;
    /** 原始账号配置（Matrix 条目或 Legacy 聚合） */
    config: WecomAccountConfig;
    /** Bot 能力 */
    bot?: ResolvedBotAccount;
    /** Agent 能力 */
    agent?: ResolvedAgentAccount;
};

/** 解析模式 */
export type ResolvedMode = "disabled" | "legacy" | "matrix";

/**
 * 已解析的模式状态
 */
export type ResolvedWecomAccounts = {
    /** 当前模式 */
    mode: ResolvedMode;
    /** 默认账号 ID */
    defaultAccountId: string;
    /** 账号集合（Legacy 下仅 default） */
    accounts: Record<string, ResolvedWecomAccount>;
    /**
     * 向后兼容：默认账号的 bot（历史调用点仍可读取）。
     * Matrix 下等价于 defaultAccountId 对应账号的 bot。
     */
    bot?: ResolvedBotAccount;
    /**
     * 向后兼容：默认账号的 agent（历史调用点仍可读取）。
     * Matrix 下等价于 defaultAccountId 对应账号的 agent。
     */
    agent?: ResolvedAgentAccount;
};

// Re-export 用于向后兼容
export type { WecomDmConfig } from "./config.js";
