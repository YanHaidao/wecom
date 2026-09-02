import type { OpenClawPluginSecurityAuditContext } from "openclaw/plugin-sdk/plugin-entry";

const PLUGIN_ID = "wecom";
const CONFLICTING_OFFICIAL_PLUGIN_ID = "wecom-openclaw-plugin";
const LEGACY_TOOL_NAMES = new Set(["wecom_mcp"]);

type JsonRecord = Record<string, unknown>;
type AuditFinding = {
  checkId: string;
  severity: "warn" | "critical";
  title: string;
  detail: string;
  remediation?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(record: JsonRecord | undefined, key: string): JsonRecord | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function stringsAt(record: JsonRecord | undefined, key: string): string[] | undefined {
  const value = record?.[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function isPositiveAgentId(value: unknown): boolean {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function collectLegacyToolPaths(value: unknown, path = "config"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectLegacyToolPaths(entry, `${path}[${index}]`));
  }
  if (!isRecord(value)) {
    return typeof value === "string" && LEGACY_TOOL_NAMES.has(value) ? [path] : [];
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    collectLegacyToolPaths(entry, `${path}.${key}`),
  );
}

function resolveWecomAccounts(config: JsonRecord): Array<[string, JsonRecord]> {
  const wecom = recordAt(recordAt(config, "channels"), "wecom");
  const accounts = recordAt(wecom, "accounts");
  if (accounts) {
    return Object.entries(accounts).filter((entry): entry is [string, JsonRecord] =>
      isRecord(entry[1]),
    );
  }
  return wecom ? [["default", wecom]] : [];
}

function collectAccountBindingFindings(config: JsonRecord): AuditFinding[] {
  const accounts = resolveWecomAccounts(config);
  if (accounts.length <= 1) {
    return [];
  }

  const covered = new Set<string>();
  let wildcard = false;
  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  for (const binding of bindings) {
    if (!isRecord(binding)) {
      continue;
    }
    const match = recordAt(binding, "match");
    if (match?.channel !== "wecom") {
      continue;
    }
    const accountId = typeof match.accountId === "string" ? match.accountId.trim() : "";
    if (accountId === "*") {
      wildcard = true;
    } else if (accountId) {
      covered.add(accountId.toLowerCase());
    }
  }

  const missing = wildcard
    ? []
    : accounts
        .map(([accountId]) => accountId)
        .filter((accountId) => !covered.has(accountId.toLowerCase()));
  if (missing.length === 0) {
    return [];
  }

  return [
    {
      checkId: "wecom.account_binding_drift",
      severity: "critical",
      title: "WeCom multi-account bindings are incomplete",
      detail: `${missing.length} of ${accounts.length} configured WeCom accounts have no exact or wildcard agent binding. Missing account ids: ${missing.join(", ")}.`,
      remediation:
        'Add bindings with match.channel="wecom" and an exact match.accountId (recommended), or an intentional wildcard binding, before enabling multi-account traffic.',
    },
  ];
}

function collectUpstreamCorpFindings(config: JsonRecord): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const seenCorpIds = new Map<string, string>();

  for (const [accountId, account] of resolveWecomAccounts(config)) {
    const agent = recordAt(account, "agent");
    const upstreamCorps = recordAt(agent, "upstreamCorps");
    if (!upstreamCorps) {
      continue;
    }
    const primaryCorpId =
      typeof agent?.corpId === "string" ? agent.corpId.trim().toLowerCase() : undefined;

    for (const [entryName, rawEntry] of Object.entries(upstreamCorps)) {
      const entry = isRecord(rawEntry) ? rawEntry : undefined;
      const corpId = typeof entry?.corpId === "string" ? entry.corpId.trim() : "";
      const agentId = entry?.agentId;
      if (!corpId || !isPositiveAgentId(agentId)) {
        findings.push({
          checkId: "wecom.upstream_corp_invalid",
          severity: "critical",
          title: "WeCom upstream enterprise mapping is incomplete",
          detail: `Account ${accountId} upstreamCorps.${entryName} must define a non-empty corpId and agentId.`,
          remediation:
            "Complete the upstream enterprise mapping before enabling shared-application callbacks; do not fall back to the primary enterprise identity.",
        });
        continue;
      }

      const normalizedCorpId = corpId.toLowerCase();
      if (primaryCorpId && normalizedCorpId === primaryCorpId) {
        findings.push({
          checkId: "wecom.upstream_matches_primary",
          severity: "warn",
          title: "WeCom upstream mapping duplicates the primary enterprise",
          detail: `Account ${accountId} upstreamCorps.${entryName} uses the same corpId as its primary Agent configuration.`,
          remediation:
            "Remove the redundant mapping or replace it with the downstream enterprise corpId.",
        });
      }

      const owner = seenCorpIds.get(normalizedCorpId);
      const current = `${accountId}.${entryName}`;
      if (owner && owner !== current) {
        findings.push({
          checkId: "wecom.upstream_corp_ambiguous",
          severity: "critical",
          title: "WeCom upstream enterprise mapping is ambiguous",
          detail: `The same upstream corpId is mapped by both ${owner} and ${current}.`,
          remediation:
            "Assign every downstream corpId to exactly one OpenClaw WeCom account so replies cannot cross enterprise boundaries.",
        });
      } else {
        seenCorpIds.set(normalizedCorpId, current);
      }
    }
  }

  return findings;
}

/** Report migration and tenant-isolation drift without loading a second WeCom Channel. */
export function collectWecomAuditFindings(
  ctx: OpenClawPluginSecurityAuditContext,
): AuditFinding[] {
  const config = ctx.config as unknown as JsonRecord;
  const plugins = recordAt(config, "plugins");
  const entries = recordAt(plugins, "entries");
  const allow = stringsAt(plugins, "allow");
  const findings: AuditFinding[] = [];

  if (plugins?.enabled === false) {
    findings.push({
      checkId: "wecom.plugins_disabled",
      severity: "critical",
      title: "OpenClaw plugins are disabled",
      detail: "The YanHaidao WeCom plugin cannot load while plugins.enabled=false.",
      remediation: "Enable the plugin system before starting WeCom traffic.",
    });
  }

  if (allow && !allow.includes(PLUGIN_ID)) {
    findings.push({
      checkId: "wecom.full_plugin_not_allowed",
      severity: "critical",
      title: "YanHaidao WeCom plugin is missing from plugins.allow",
      detail: `plugins.allow is configured but does not contain ${PLUGIN_ID}.`,
      remediation: `Add ${PLUGIN_ID} to plugins.allow before starting WeCom traffic.`,
    });
  }
  if (allow?.includes(CONFLICTING_OFFICIAL_PLUGIN_ID)) {
    findings.push({
      checkId: "wecom.conflicting_official_plugin_allowed",
      severity: "critical",
      title: "A second WeCom Channel owner is allowed",
      detail: `plugins.allow contains both ${PLUGIN_ID} and ${CONFLICTING_OFFICIAL_PLUGIN_ID}.`,
      remediation: `Remove ${CONFLICTING_OFFICIAL_PLUGIN_ID}; this full plugin already carries the reviewed official functionality.`,
    });
  }

  const conflictingEntry = recordAt(entries, CONFLICTING_OFFICIAL_PLUGIN_ID);
  if (conflictingEntry && conflictingEntry.enabled !== false) {
    findings.push({
      checkId: "wecom.conflicting_official_plugin_enabled",
      severity: "critical",
      title: "A second WeCom Channel owner is enabled",
      detail: `plugins.entries.${CONFLICTING_OFFICIAL_PLUGIN_ID} exists and is not explicitly disabled.`,
      remediation: `Disable or remove plugins.entries.${CONFLICTING_OFFICIAL_PLUGIN_ID}.`,
    });
  }

  const pluginEntry = recordAt(entries, PLUGIN_ID);
  if (pluginEntry?.enabled === false) {
    findings.push({
      checkId: "wecom.full_plugin_disabled",
      severity: "critical",
      title: "YanHaidao WeCom plugin is disabled",
      detail: `plugins.entries.${PLUGIN_ID}.enabled=false.`,
      remediation: `Enable plugins.entries.${PLUGIN_ID} after isolated acceptance testing succeeds.`,
    });
  }

  const legacyToolPaths = collectLegacyToolPaths(config);
  if (legacyToolPaths.length > 0) {
    findings.push({
      checkId: "wecom.legacy_tools_allowed",
      severity: "warn",
      title: "Retired wecom_mcp tool remains in configuration",
      detail: `Found ${legacyToolPaths.length} references to retired wecom_mcp at: ${legacyToolPaths.join(", ")}.`,
      remediation: "Replace wecom_mcp with wecom-cli.",
    });
  }

  findings.push(...collectAccountBindingFindings(config));
  findings.push(...collectUpstreamCorpFindings(config));
  return findings;
}
