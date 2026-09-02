import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { listWecomAddonAccountIds, resolveDefaultWecomAddonAccountId } from "./agent-account.js";

type WecomAddonToolContext = {
  messageChannel?: string;
  agentAccountId?: string;
  accountId?: string;
};

function normalize(value: unknown): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

export function isWecomAddonToolContext(context: WecomAddonToolContext | undefined): boolean {
  return context?.messageChannel === "wecom";
}

/** Resolve the official Channel's account context without allowing a tool call to switch tenants. */
export function resolveBoundWecomAccountId(params: {
  cfg: OpenClawConfig;
  requestedAccountId?: unknown;
  toolContext?: WecomAddonToolContext;
}): string {
  const contextAccountId = normalize(
    params.toolContext?.agentAccountId ?? params.toolContext?.accountId,
  );
  const requestedAccountId = normalize(params.requestedAccountId);

  if (
    contextAccountId &&
    requestedAccountId &&
    contextAccountId.toLowerCase() !== requestedAccountId.toLowerCase()
  ) {
    throw new Error(
      `拒绝跨账号调用：当前企业微信会话绑定账号为 ${contextAccountId}，请求指定了 ${requestedAccountId}`,
    );
  }

  const accountIds = listWecomAddonAccountIds(params.cfg);
  if (accountIds.length > 1 && !contextAccountId) {
    throw new Error("当前企业微信会话缺少 accountId；多账号模式下为防止跨企业访问，本次调用已拒绝");
  }

  return contextAccountId ?? requestedAccountId ?? resolveDefaultWecomAddonAccountId(params.cfg);
}
