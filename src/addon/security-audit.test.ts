import { describe, expect, it } from "vitest";
import { collectWecomAuditFindings } from "./security-audit.js";

function audit(config: Record<string, unknown>) {
  return collectWecomAuditFindings({
    config,
    sourceConfig: config,
    env: {},
    stateDir: "/tmp/openclaw-state",
    configPath: "/tmp/openclaw.json",
  } as never);
}

describe("full WeCom plugin audit", () => {
  it("accepts a single-owner single-account setup", () => {
    expect(
      audit({
        plugins: {
          allow: ["wecom"],
          entries: {
            wecom: { enabled: true },
          },
        },
        channels: { wecom: { accounts: { primary: { agent: { corpId: "ww-main" } } } } },
      }),
    ).toEqual([]);
  });

  it("reports a conflicting Channel owner and retired tool drift", () => {
    const findings = audit({
      plugins: {
        allow: ["wecom", "wecom-openclaw-plugin"],
        entries: {
          wecom: { enabled: true },
          "wecom-openclaw-plugin": { enabled: true },
        },
      },
      agents: { defaults: { tools: { alsoAllow: ["wecom_mcp"] } } },
    });

    expect(findings.map((finding) => finding.checkId)).toEqual(
      expect.arrayContaining([
        "wecom.conflicting_official_plugin_allowed",
        "wecom.conflicting_official_plugin_enabled",
        "wecom.legacy_tools_allowed",
      ]),
    );
  });

  it("fails closed when multi-account agent bindings are incomplete", () => {
    const findings = audit({
      plugins: { entries: { wecom: {} } },
      channels: {
        wecom: {
          accounts: {
            primary: { agent: { corpId: "ww-primary" } },
            sales: { agent: { corpId: "ww-sales" } },
          },
        },
      },
      bindings: [{ agentId: "main", match: { channel: "wecom", accountId: "primary" } }],
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        checkId: "wecom.account_binding_drift",
        severity: "critical",
        detail: expect.stringContaining("sales"),
      }),
    );
  });

  it("detects invalid and ambiguous upstream enterprise mappings without exposing secrets", () => {
    const findings = audit({
      plugins: { entries: { wecom: {} } },
      channels: {
        wecom: {
          accounts: {
            primary: {
              agent: {
                corpId: "ww-primary",
                upstreamCorps: {
                  invalid: { corpId: "ww-missing-agent" },
                  zero: { corpId: "ww-zero-agent", agentId: 0 },
                  partner: { corpId: "ww-shared", agentId: 1001, secret: "must-not-leak" },
                },
              },
            },
            sales: {
              agent: {
                corpId: "ww-sales",
                upstreamCorps: { partner: { corpId: "WW-SHARED", agentId: 1002 } },
              },
            },
          },
        },
      },
      bindings: [{ agentId: "main", match: { channel: "wecom", accountId: "*" } }],
    });

    expect(findings.map((finding) => finding.checkId)).toEqual(
      expect.arrayContaining([
        "wecom.upstream_corp_invalid",
        "wecom.upstream_corp_ambiguous",
      ]),
    );
    expect(
      findings.filter((finding) => finding.checkId === "wecom.upstream_corp_invalid"),
    ).toHaveLength(2);
    expect(JSON.stringify(findings)).not.toContain("must-not-leak");
  });
});
