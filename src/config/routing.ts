import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { WecomConfig } from "../types/index.js";
import { detectMode } from "./accounts.js";

/**
 * 默认策略：
 * - matrix（多账号）: 开启 fail-closed，防止未绑定账号回退到 main
 * - legacy（单账号兼容）: 维持历史行为，不强制拦截
 */
export function resolveWecomFailClosedOnDefaultRoute(cfg: OpenClawConfig): boolean {
    const wecom = cfg.channels?.wecom as WecomConfig | undefined;
    const explicit = wecom?.routing?.failClosedOnDefaultRoute;
    if (typeof explicit === "boolean") return explicit;
    return detectMode(wecom) === "matrix";
}

export function shouldRejectWecomDefaultRoute(params: {
    cfg: OpenClawConfig;
    matchedBy: string;
    useDynamicAgent: boolean;
}): boolean {
    if (params.matchedBy !== "default") return false;
    if (params.useDynamicAgent) return false;
    return resolveWecomFailClosedOnDefaultRoute(params.cfg);
}
