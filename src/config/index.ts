/**
 * WeCom 配置模块导出
 */

export { WecomConfigSchema, type WecomConfigInput } from "./schema.js";
export {
    detectMode,
    resolveWecomAccounts,
    isWecomEnabled,
} from "./accounts.js";
