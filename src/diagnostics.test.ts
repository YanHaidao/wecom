import { describe, expect, it } from "vitest";
import {
  diagnosticEndpoint,
  diagnosticFingerprint,
  diagnosticPath,
  formatDiagnosticError,
  sanitizeSdkLog,
  wecomFlowId,
} from "./diagnostics.js";

describe("WeCom diagnostic privacy", () => {
  it("creates stable correlation ids without retaining source identifiers", () => {
    const raw = "sensitive-user-and-request-id";
    const first = diagnosticFingerprint(raw);

    expect(first).toBe(diagnosticFingerprint(raw));
    expect(first).not.toContain(raw);
    expect(wecomFlowId({ accountId: "default", reqId: raw, messageId: "message-1" }))
      .not.toContain(raw);
  });

  it("removes callback bodies and download URLs from SDK debug messages", () => {
    expect(
      sanitizeSdkLog('[server -> plugin] cmd=aibot_msg_callback, reqId=req-1, body={"text":"secret"}'),
    ).toBe("[server -> plugin] cmd=aibot_msg_callback, reqId=req-1, body=<redacted>");
    expect(sanitizeSdkLog("[plugin] downloadFile: url=https://secret.example/file hasAesKey=true"))
      .toBe("[plugin] downloadFile: url=<redacted> hasAesKey=true");
    expect(
      sanitizeSdkLog('botId=bot-123 secret=secret-123 payload={"token":"token-123"}'),
    ).toBe('botId=<redacted> secret=<redacted> payload={"token":"<redacted>"}');
    expect(sanitizeSdkLog("Authorization: Bearer token-123 command=connect"))
      .toBe("Authorization=<redacted> command=connect");
  });

  it("keeps endpoint and error diagnostics useful without query secrets", () => {
    expect(diagnosticEndpoint("wss://openws.work.weixin.qq.com/connect?token=secret"))
      .toBe("wss://openws.work.weixin.qq.com");
    const error = Object.assign(new Error("request failed token=secret-123"), {
      code: "ECONNRESET",
    });
    const output = formatDiagnosticError(error);
    expect(output).toContain("name=Error");
    expect(output).toContain("code=ECONNRESET");
    expect(output).not.toContain("secret-123");
  });

  it("fingerprints local paths and removes them from dependency errors", () => {
    const rawPath = "/Users/private/Documents/quarterly-plan.pdf";
    expect(diagnosticPath(rawPath)).not.toContain(rawPath);

    const output = formatDiagnosticError(new Error(`failed reading ${rawPath}`));
    expect(output).toContain("local-path:");
    expect(output).not.toContain(rawPath);
    expect(output).not.toContain("quarterly-plan.pdf");
  });
});
