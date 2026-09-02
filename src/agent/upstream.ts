import type { ResolvedAgentAccount, WecomUpstreamCorpConfig } from "../types/index.js";

const UPSTREAM_TARGET_PREFIX = "wecom-agent-upstream:";

export type ResolvedUpstreamCorp = {
  configKey: string;
  corpId: string;
  agentId: number;
};

export type InboundAgentIdentity =
  | { kind: "primary" }
  | { kind: "upstream"; upstream: ResolvedUpstreamCorp }
  | { kind: "reject"; reason: string };

export type ParsedUpstreamAgentTarget = {
  accountId: string;
  corpId: string;
  userId: string;
};

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function parseAgentId(value: number | string): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function matchingUpstreamCorps(
  upstreamCorps: Record<string, WecomUpstreamCorpConfig> | undefined,
  corpId: string,
): Array<{ key: string; value: WecomUpstreamCorpConfig }> {
  const normalizedCorpId = normalizeIdentity(corpId);
  return Object.entries(upstreamCorps ?? {})
    .filter(([, value]) => normalizeIdentity(value.corpId) === normalizedCorpId)
    .map(([key, value]) => ({ key, value }));
}

export function resolveConfiguredUpstreamCorp(params: {
  agent: ResolvedAgentAccount;
  corpId: string;
}): ResolvedUpstreamCorp {
  const corpId = params.corpId.trim();
  const matches = matchingUpstreamCorps(params.agent.config.upstreamCorps, corpId);
  if (matches.length === 0) {
    throw new Error(
      `WeCom upstream corp=${corpId || "<empty>"} is not configured for account=${params.agent.accountId}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `WeCom upstream corp=${corpId} is ambiguous for account=${params.agent.accountId}`,
    );
  }

  const match = matches[0]!;
  const agentId = parseAgentId(match.value.agentId);
  if (agentId === undefined) {
    throw new Error(
      `WeCom upstream corp=${corpId} has an invalid agentId for account=${params.agent.accountId}`,
    );
  }
  return {
    configKey: match.key,
    corpId: match.value.corpId.trim(),
    agentId,
  };
}

export function resolveInboundAgentIdentity(params: {
  agent: ResolvedAgentAccount;
  messageToUserName: string;
}): InboundAgentIdentity {
  const destinationCorpId = params.messageToUserName.trim();
  if (!destinationCorpId) {
    return { kind: "reject", reason: "missing ToUserName" };
  }
  if (normalizeIdentity(destinationCorpId) === normalizeIdentity(params.agent.corpId)) {
    return { kind: "primary" };
  }
  try {
    return {
      kind: "upstream",
      upstream: resolveConfiguredUpstreamCorp({
        agent: params.agent,
        corpId: destinationCorpId,
      }),
    };
  } catch (error) {
    return {
      kind: "reject",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildUpstreamAgentTarget(params: ParsedUpstreamAgentTarget): string {
  const parts = [params.accountId, params.corpId, params.userId].map((value) => {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("WeCom upstream target parts must not be empty");
    return encodeURIComponent(trimmed);
  });
  return `${UPSTREAM_TARGET_PREFIX}${parts.join(":")}`;
}

export function parseUpstreamAgentTarget(raw: string): ParsedUpstreamAgentTarget | undefined {
  const trimmed = raw.trim().replace(/^wecom:/i, "");
  if (!trimmed.toLowerCase().startsWith(UPSTREAM_TARGET_PREFIX)) return undefined;
  const encodedParts = trimmed.slice(UPSTREAM_TARGET_PREFIX.length).split(":");
  if (encodedParts.length !== 3) {
    throw new Error(`Invalid WeCom upstream target: ${raw}`);
  }
  let parts: string[];
  try {
    parts = encodedParts.map((value) => decodeURIComponent(value).trim());
  } catch {
    throw new Error(`Invalid WeCom upstream target encoding: ${raw}`);
  }
  if (parts.some((value) => !value)) {
    throw new Error(`Invalid WeCom upstream target: ${raw}`);
  }
  return { accountId: parts[0]!, corpId: parts[1]!, userId: parts[2]! };
}

export function resolveOutboundUpstreamTarget(params: {
  agent: ResolvedAgentAccount;
  target: string;
}): { upstream: ResolvedUpstreamCorp; userId: string } | undefined {
  const parsed = parseUpstreamAgentTarget(params.target);
  if (!parsed) return undefined;
  if (normalizeIdentity(parsed.accountId) !== normalizeIdentity(params.agent.accountId)) {
    throw new Error(
      `WeCom upstream target account=${parsed.accountId} cannot be sent by account=${params.agent.accountId}`,
    );
  }
  return {
    upstream: resolveConfiguredUpstreamCorp({ agent: params.agent, corpId: parsed.corpId }),
    userId: parsed.userId,
  };
}
