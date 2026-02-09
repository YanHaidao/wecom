/**
 * WeCom 配置模块导出
 */

export { WecomConfigSchema, type WecomConfigInput } from "./schema.js";
export {
    DEFAULT_ACCOUNT_ID,
    detectMode,
    listWecomAccountIds,
    resolveDefaultWecomAccountId,
    resolveWecomAccount,
    resolveWecomAccounts,
    isWecomEnabled,
} from "./accounts.js";
export { resolveWecomEgressProxyUrl, resolveWecomEgressProxyUrlFromNetwork } from "./network.js";
export { DEFAULT_WECOM_MEDIA_MAX_BYTES, resolveWecomMediaMaxBytes } from "./media.js";
