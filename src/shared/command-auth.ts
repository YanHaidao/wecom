import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";

import { CHANNEL_ID } from "../const.js";
import type { WecomAgentConfig, WecomBotConfig } from "../types/index.js";

type WecomCommandAuthAccountConfig = Pick<WecomBotConfig, "dmPolicy" | "allowFrom"> | Pick<WecomAgentConfig, "dmPolicy" | "allowFrom">;

function normalizeWecomAllowFromEntry(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^wecom:/, "")
    .replace(/^user:/, "")
    .replace(/^userid:/, "");
}

function isWecomSenderAllowed(senderUserId: string, allowFrom: string[]): boolean {
  const list = allowFrom.map((entry) => normalizeWecomAllowFromEntry(entry)).filter(Boolean);
  if (list.includes("*")) return true;
  const normalizedSender = normalizeWecomAllowFromEntry(senderUserId);
  if (!normalizedSender) return false;
  return list.includes(normalizedSender);
}

export async function resolveWecomCommandAuthorization(params: {
  core: PluginRuntime;
  cfg: OpenClawConfig;
  accountId: string;
  accountConfig: WecomCommandAuthAccountConfig;
  rawBody: string;
  senderUserId: string;
  isGroup: boolean;
}): Promise<{
  shouldComputeAuth: boolean;
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  senderAllowed: boolean;
  authorizerConfigured: boolean;
  commandAuthorized: boolean | undefined;
  effectiveAllowFrom: string[];
}> {
  const { core, cfg, accountId, accountConfig, rawBody, senderUserId, isGroup } = params;

  const dmPolicy = (accountConfig.dmPolicy ?? "pairing") as "pairing" | "allowlist" | "open" | "disabled";
  const configAllowFrom = (accountConfig.allowFrom ?? []).map((v) => String(v));

  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(rawBody, cfg);
  const storeAllowFrom =
    dmPolicy === "pairing" && !isGroup
      ? await core.channel.pairing
          .readAllowFromStore({ channel: CHANNEL_ID, accountId })
          .catch(() => [])
      : [];
  const effectiveAllowFrom =
    dmPolicy === "open"
      ? ["*"]
      : dmPolicy === "disabled"
        ? []
        : [...configAllowFrom, ...storeAllowFrom];

  const senderAllowed = isWecomSenderAllowed(senderUserId, effectiveAllowFrom);
  const allowAllConfigured = effectiveAllowFrom.some((entry) => normalizeWecomAllowFromEntry(entry) === "*");
  const authorizerConfigured = allowAllConfigured || effectiveAllowFrom.length > 0;
  const useAccessGroups = true;

  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
      useAccessGroups,
      authorizers: [{ configured: authorizerConfigured, allowed: senderAllowed }],
    })
    : undefined;

  return {
    shouldComputeAuth,
    dmPolicy,
    senderAllowed,
    authorizerConfigured,
    commandAuthorized,
    effectiveAllowFrom,
  };
}

export function buildWecomUnauthorizedCommandPrompt(params: {
  senderUserId: string;
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  scope: "bot" | "agent";
  accountId: string;
  multiAccount: boolean;
}): string {
  const user = params.senderUserId || "unknown";
  const policy = params.dmPolicy;
  const scopeLabel = params.scope === "bot" ? "Bot（智能机器人）" : "Agent（自建应用）";
  const accountPrefix = params.multiAccount
    ? `channels.wecom.accounts.${params.accountId}`
    : "channels.wecom";
  const dmPrefix = params.scope === "agent" ? `${accountPrefix}.agent` : accountPrefix;
  const allowCmd = (value: string) => `openclaw config set ${dmPrefix}.allowFrom '${value}'`;
  const policyCmd = (value: string) => `openclaw config set ${dmPrefix}.dmPolicy "${value}"`;

  if (policy === "disabled") {
    return [
      `无权限执行命令（${scopeLabel} 已禁用：dmPolicy=disabled）`,
      `触发者：${user}`,
      `管理员：${policyCmd("open")}（全放开）或 ${policyCmd("allowlist")}（白名单）`,
    ].join("\n");
  }
  if (policy === "pairing") {
    return [
      `无权限执行命令（入口：${scopeLabel}，userid：${user}）`,
      `管理员审批：openclaw pairing list wecom`,
      `然后执行：openclaw pairing approve wecom <code>`,
      `也可改为全放开：${policyCmd("open")}`,
    ].join("\n");
  }
  return [
    `无权限执行命令（入口：${scopeLabel}，userid：${user}）`,
    `管理员全放开：${policyCmd("open")}`,
    `管理员放行该用户：${policyCmd("allowlist")}`,
    `然后设置白名单：${allowCmd(JSON.stringify([user]))}`,
  ].join("\n");
}
