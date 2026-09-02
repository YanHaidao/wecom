import { describe, expect, it } from "vitest";
import { createWecomEnterpriseDiagnosticsReport } from "./cli.js";

describe("full WeCom diagnostics report", () => {
  it("passes a single-owner configuration", () => {
    const report = createWecomEnterpriseDiagnosticsReport({
      plugins: {
        allow: ["wecom"],
        entries: {
          wecom: { enabled: true },
        },
      },
    });

    expect(report).toEqual({
      ok: true,
      summary: { critical: 0, warn: 0, total: 0 },
      findings: [],
    });
  });

  it("returns a failing machine-readable report for migration drift", () => {
    const report = createWecomEnterpriseDiagnosticsReport({
      plugins: {
        allow: ["wecom-openclaw-plugin"],
        entries: { "wecom-openclaw-plugin": { enabled: true } },
      },
    });

    expect(report.ok).toBe(false);
    expect(report.summary.critical).toBeGreaterThan(0);
    expect(report.findings.map((finding) => finding.checkId)).toEqual(
      expect.arrayContaining([
        "wecom.full_plugin_not_allowed",
        "wecom.conflicting_official_plugin_allowed",
        "wecom.conflicting_official_plugin_enabled",
      ]),
    );
  });
});
