import { createHash } from "node:crypto";

/** Stable, non-reversible identifier for joining WeCom flow logs without exposing raw ids. */
export function diagnosticFingerprint(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!normalized) return "none";
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 10);
  return `${normalized.length}:${digest}`;
}

export function wecomFlowId(params: {
  accountId: string;
  reqId?: string;
  messageId?: string;
}): string {
  const transportId = params.reqId?.trim() || params.messageId?.trim();
  return diagnosticFingerprint(transportId || params.accountId);
}

export function utf8Bytes(value: string | undefined): number {
  return value ? Buffer.byteLength(value, "utf8") : 0;
}

/** Keep endpoint ownership visible while removing paths, queries, and credentials. */
export function diagnosticEndpoint(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return diagnosticFingerprint(value);
  }
}

/** Identify a local artifact in logs without exposing its directory or filename. */
export function diagnosticPath(value: unknown): string {
  return diagnosticFingerprint(value);
}

/** Remove common credential forms before forwarding dependency diagnostics. */
export function sanitizeSdkLog(message: string): string {
  return message
    .replace(/, body=.*$/s, ", body=<redacted>")
    .replace(/\b(?:https?|wss?):\/\/[^\s,)}\]]+/gi, (value) => diagnosticEndpoint(value))
    .replace(/\bfile:\/\/\/[^\s,)}\]]+/gi, "file:///<redacted>")
    .replace(/(?:^|[\s=:])\/(?:Users|home|root|private|tmp|var|opt)\/[^\s,)}\]]+/g, (value) => {
      const prefix = value.match(/^[\s=:]/)?.[0] ?? "";
      return `${prefix}<local-path:${diagnosticFingerprint(value.slice(prefix.length))}>`;
    })
    .replace(/url=\S+/gi, "url=<redacted>")
    .replace(/\b(authorization)\s*[:=]\s*(?:bearer\s+)?[^\s,}]+/gi, "$1=<redacted>")
    .replace(/\b(bot_?id|secret|token|encoding_?aes_?key|corp_?secret)\s*=\s*[^\s,}]+/gi, "$1=<redacted>")
    .replace(/(["'](?:botId|secret|token|encodingAESKey|corpSecret)["']\s*:\s*)["'][^"']*["']/gi, "$1\"<redacted>\"");
}

/** Produce one-line error diagnostics without leaking credential-shaped values. */
export function formatDiagnosticError(error: unknown): string {
  if (!(error instanceof Error)) {
    return `name=UnknownError message=${sanitizeSdkLog(String(error))}`;
  }
  const record = error as Error & { code?: unknown; errcode?: unknown; status?: unknown };
  const fields = [
    `name=${error.name || "Error"}`,
    `message=${sanitizeSdkLog(error.message || String(error))}`,
  ];
  if (record.code !== undefined) fields.push(`code=${String(record.code)}`);
  if (record.errcode !== undefined) fields.push(`errcode=${String(record.errcode)}`);
  if (record.status !== undefined) fields.push(`status=${String(record.status)}`);
  return fields.join(" ");
}
