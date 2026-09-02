import type {
  OpenClawPluginApi,
  OpenClawPluginSecurityAuditContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { collectWecomAuditFindings } from "./security-audit.js";

type JsonRecord = Record<string, unknown>;

export type WecomEnterpriseDiagnosticsReport = {
  ok: boolean;
  summary: {
    critical: number;
    warn: number;
    total: number;
  };
  findings: ReturnType<typeof collectWecomAuditFindings>;
};

function createReportFromFindings(
  findings: ReturnType<typeof collectWecomAuditFindings>,
): WecomEnterpriseDiagnosticsReport {
  const critical = findings.filter((finding) => finding.severity === "critical").length;
  const warn = findings.filter((finding) => finding.severity === "warn").length;
  return {
    ok: critical === 0,
    summary: { critical, warn, total: findings.length },
    findings,
  };
}

export function createWecomEnterpriseDiagnosticsReport(
  config: JsonRecord,
): WecomEnterpriseDiagnosticsReport {
  const findings = collectWecomAuditFindings({
    config,
    sourceConfig: config,
    env: process.env,
    stateDir: "",
    configPath: "",
  } as OpenClawPluginSecurityAuditContext);
  return createReportFromFindings(findings);
}

function formatDiagnosticsReport(report: WecomEnterpriseDiagnosticsReport): string {
  const lines = [
    `YanHaidao WeCom diagnostics: ${report.ok ? "PASS" : "FAIL"}`,
    `Findings: ${report.summary.critical} critical, ${report.summary.warn} warning`,
  ];
  for (const finding of report.findings) {
    lines.push("", `[${finding.severity.toUpperCase()}] ${finding.checkId}: ${finding.title}`);
    lines.push(finding.detail);
    if (finding.remediation) {
      lines.push(`Remediation: ${finding.remediation}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Provide deterministic drift checks even when OpenClaw runs a non-activating audit snapshot. */
export function registerWecomDiagnosticsCli(api: OpenClawPluginApi): void {
  api.registerCli(
    ({ program }) => {
      const root = program
        .command("wecom")
        .description("Inspect the full WeCom plugin and account-isolation drift");
      root
        .command("diagnose")
        .description("Check plugin ownership, bindings, legacy tools, and upstream corps")
        .option("--json", "Emit JSON output")
        .action(async (options: { json?: boolean }) => {
          const { readConfigFileSnapshot } = await import("openclaw/plugin-sdk/health");
          const snapshot = await readConfigFileSnapshot({ observe: false });
          const report = snapshot.valid
            ? createWecomEnterpriseDiagnosticsReport(snapshot.config as JsonRecord)
            : createReportFromFindings(
                snapshot.issues.map((issue) => ({
                  checkId: "wecom.config_invalid",
                  severity: "critical" as const,
                  title: "OpenClaw configuration is invalid",
                  detail: issue.message,
                  remediation: "Fix the reported OpenClaw configuration error and rerun diagnostics.",
                })),
              );
          process.stdout.write(
            options.json
              ? `${JSON.stringify(report, null, 2)}\n`
              : formatDiagnosticsReport(report),
          );
          process.exitCode = report.ok ? 0 : 1;
        });
    },
    {
      descriptors: [
        {
          name: "wecom",
          description: "Inspect WeCom configuration and enterprise account drift",
          hasSubcommands: true,
          machineOutput: ({ argv }) => argv.includes("--json"),
        },
      ],
    },
  );
}
