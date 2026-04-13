import { decryptWecomMediaWithMeta } from "../../media.js";
import {
  resolveWecomEgressProxyUrl,
  resolveWecomMediaDownloadTimeoutMs,
  resolveWecomMediaMaxBytes,
} from "../../config/index.js";
import type { WecomBotInboundMessage as WecomInboundMessage } from "../../types/index.js";
import type { WecomWebhookTarget } from "../../types/runtime-context.js";
import { buildInboundBody } from "./message-shape.js";

const MIME_BY_EXT: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  html: "text/html",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  zip: "application/zip",
  bin: "application/octet-stream",
};

const EXT_BY_MIME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext])),
  "application/octet-stream": "bin",
};

const GENERIC_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/download",
]);

export type BotInboundMedia = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

export type BotInboundNormalizationResult = {
  body: string;
  media?: BotInboundMedia;
};

type InboundMediaKind = "image" | "file" | "video";
type MediaFailureReason = "expired_or_forbidden" | "timeout" | "size_limit" | "decrypt";
type QuoteMediaCandidate = {
  kind: InboundMediaKind;
  url: string;
  aesKey?: string;
  explicitFilename?: string;
};

function normalizeContentType(raw?: string | null): string | undefined {
  const normalized = String(raw ?? "").trim().split(";")[0]?.trim().toLowerCase();
  return normalized || undefined;
}

function isGenericContentType(raw?: string | null): boolean {
  const normalized = normalizeContentType(raw);
  if (!normalized) return true;
  return GENERIC_CONTENT_TYPES.has(normalized);
}

export function guessContentTypeFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  return MIME_BY_EXT[ext];
}

function guessExtensionFromContentType(contentType?: string): string | undefined {
  const normalized = normalizeContentType(contentType);
  if (!normalized) return undefined;
  if (normalized === "image/jpeg") return "jpg";
  return EXT_BY_MIME[normalized];
}

function extractFileNameFromUrl(rawUrl?: string): string | undefined {
  const s = String(rawUrl ?? "").trim();
  if (!s) return undefined;
  try {
    const u = new URL(s);
    const name = decodeURIComponent(u.pathname.split("/").pop() ?? "").trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

function sanitizeInboundFilename(raw?: string): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  const base = s.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base) return undefined;
  const sanitized = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
  return sanitized || undefined;
}

function hasLikelyExtension(name?: string): boolean {
  if (!name) return false;
  return /\.[a-z0-9]{1,16}$/i.test(name);
}

function detectMimeFromBuffer(buffer: Buffer): string | undefined {
  if (!buffer || buffer.length < 4) return undefined;
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp";
  }
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "OggS") {
    return "audio/ogg";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") {
    return "audio/wav";
  }
  if (buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return "audio/mpeg";
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return "video/mp4";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  ) {
    return "application/msword";
  }
  const zipMagic =
    (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) ||
    (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x05 && buffer[3] === 0x06) ||
    (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x07 && buffer[3] === 0x08);
  if (zipMagic) {
    const probe = buffer.subarray(0, Math.min(buffer.length, 512 * 1024));
    if (probe.includes(Buffer.from("word/"))) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (probe.includes(Buffer.from("xl/"))) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (probe.includes(Buffer.from("ppt/"))) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    return "application/zip";
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let printable = 0;
  for (const b of sample) {
    if (b === 0x00) return undefined;
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) {
      printable += 1;
    }
  }
  if (sample.length > 0 && printable / sample.length > 0.95) {
    return "text/plain";
  }
  return undefined;
}

function resolveInlineFileName(input: unknown): string | undefined {
  return sanitizeInboundFilename(String(input ?? "").trim());
}

function pickBotFileName(msg: WecomInboundMessage, item?: Record<string, any>): string | undefined {
  const fromItem = item
    ? resolveInlineFileName(item?.filename ?? item?.file_name ?? item?.fileName ?? item?.name ?? item?.title)
    : undefined;
  if (fromItem) return fromItem;
  return resolveInlineFileName(
    (msg as any)?.file?.filename ??
      (msg as any)?.file?.file_name ??
      (msg as any)?.file?.fileName ??
      (msg as any)?.file?.name ??
      (msg as any)?.file?.title ??
      (msg as any)?.filename ??
      (msg as any)?.fileName ??
      (msg as any)?.FileName,
  );
}

function inferInboundMediaMeta(params: {
  kind: "image" | "file";
  buffer: Buffer;
  sourceUrl?: string;
  sourceContentType?: string;
  sourceFilename?: string;
  explicitFilename?: string;
}): { contentType: string; filename: string } {
  const headerType = normalizeContentType(params.sourceContentType);
  const magicType = detectMimeFromBuffer(params.buffer);
  const rawUrlName = sanitizeInboundFilename(extractFileNameFromUrl(params.sourceUrl));
  const guessedByUrl = hasLikelyExtension(rawUrlName) ? rawUrlName : undefined;
  const explicitName = sanitizeInboundFilename(params.explicitFilename);
  const sourceName = sanitizeInboundFilename(params.sourceFilename);
  const chosenName = explicitName || sourceName || guessedByUrl;
  const typeByName = chosenName ? guessContentTypeFromPath(chosenName) : undefined;

  let contentType: string;
  if (params.kind === "image") {
    if (magicType?.startsWith("image/")) contentType = magicType;
    else if (headerType?.startsWith("image/")) contentType = headerType;
    else if (typeByName?.startsWith("image/")) contentType = typeByName;
    else contentType = "image/jpeg";
  } else {
    contentType = magicType || (!isGenericContentType(headerType) ? headerType! : undefined) || typeByName || "application/octet-stream";
  }

  const hasExt = Boolean(chosenName && /\.[a-z0-9]{1,16}$/i.test(chosenName));
  const ext = guessExtensionFromContentType(contentType) || (params.kind === "image" ? "jpg" : "bin");
  const filename = chosenName ? (hasExt ? chosenName : `${chosenName}.${ext}`) : `${params.kind}.${ext}`;
  return { contentType, filename };
}

export function looksLikeSendLocalFileIntent(rawBody: string): boolean {
  const t = rawBody.trim();
  if (!t) return false;
  return /(发送|发给|发到|转发|把.*发|把.*发送|帮我发|给我发)/.test(t);
}

/**
 * 根据错误信息对媒体下载/解密失败进行分类。
 * 用于区分不同的失败原因：URL 过期、网络超时、文件超大、解密异常。
 */
function classifyMediaFailure(error: unknown): MediaFailureReason {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  // 优先检查 URL 过期或禁止访问（403/401 或签名过期）
  if (
    message.includes("403") ||
    message.includes("forbidden") ||
    message.includes("expired") ||
    message.includes("signature") ||
    message.includes("status=401")
  ) {
    return "expired_or_forbidden";
  }
  // 检查网络超时（5 分钟 URL 时效窗口内的超时属于此类）
  if (message.includes("timeout") || message.includes("timed out") || message.includes("abort")) {
    return "timeout";
  }
  // 检查文件大小超限
  if (
    message.includes("maxbytes") ||
    message.includes("exceed") ||
    message.includes("too large") ||
    message.includes("payload too large")
  ) {
    return "size_limit";
  }
  // 其他错误默认归类为解密失败
  return "decrypt";
}

/**
 * 从引用消息中选择并提取第一个可用的媒体候选。
 * 
 * 优先级规则：
 * 1. quote.image / quote.file / quote.video：单个媒体类型直接提取
 * 2. quote.mixed：从多个 msg_item 中提取第一个 image
 * 3. URI 过期约 5 分钟，必须尽快下载/解密
 * 
 * @returns 包含 kind、url、aesKey、filename 的候选项，或 undefined
 */
function resolveQuoteMediaCandidate(msg: WecomInboundMessage): QuoteMediaCandidate | undefined {
  const quote = (msg as any)?.quote;
  const quoteType = String(quote?.msgtype ?? "").toLowerCase();
  
  // 处理单个媒体类型：image、file、video
  if (quoteType === "image" || quoteType === "file" || quoteType === "video") {
    const kind = quoteType as InboundMediaKind;
    const url = String(quote?.[kind]?.url ?? "").trim();
    if (!url) return undefined;
    return {
      kind,
      url,
      aesKey: quote?.[kind]?.aeskey,
      explicitFilename: pickBotFileName(msg, quote?.[kind]),
    };
  }

  // 处理混合消息类型：从 msg_item 数组中提取第一个图片
  if (quoteType === "mixed" && Array.isArray(quote?.mixed?.msg_item)) {
    for (const item of quote.mixed.msg_item) {
      const itemType = String(item?.msgtype ?? "").toLowerCase();
      if (itemType !== "image") {
        continue;
      }
      const url = String(item?.image?.url ?? "").trim();
      if (!url) {
        continue;
      }
      return {
        kind: "image",
        url,
        aesKey: item?.image?.aeskey,
        explicitFilename: pickBotFileName(msg, item?.image),
      };
    }
  }

  return undefined;
}

export async function processBotInboundMessage(params: {
  target: WecomWebhookTarget;
  msg: WecomInboundMessage;
  recordOperationalIssue: (event: {
    category: "media-decrypt-failed";
    messageId?: string;
    summary: string;
    raw: { transport: "bot-webhook"; envelopeType: "json"; body: WecomInboundMessage };
    error?: string;
  }) => void;
}): Promise<BotInboundNormalizationResult> {
  const { target, msg, recordOperationalIssue } = params;
  const msgtype = String(msg.msgtype ?? "").toLowerCase();
  const aesKey = target.account.encodingAESKey;
  const maxBytes = resolveWecomMediaMaxBytes(target.config, target.account.accountId);
  const proxyUrl = resolveWecomEgressProxyUrl(target.config);
  const mediaTimeoutMs = resolveWecomMediaDownloadTimeoutMs(target.config);

  const handleMediaFailure = (payload: {
    scope: string;
    kind: InboundMediaKind;
    url: string;
    error: unknown;
    bodyFallback: string;
  }): BotInboundNormalizationResult => {
    const reason = classifyMediaFailure(payload.error);
    const hint =
      reason === "timeout"
        ? `可调大 channels.wecom.media.downloadTimeoutMs（当前=${mediaTimeoutMs}ms）例如：openclaw config set channels.wecom.media.downloadTimeoutMs 45000`
        : `可调大 channels.wecom.mediaMaxMb（当前=${Math.round(maxBytes / (1024 * 1024))}MB）例如：openclaw config set channels.wecom.mediaMaxMb 50`;
    target.runtime.error?.(
      `Failed to decrypt ${payload.scope} ${payload.kind}: ${String(payload.error)} reason=${reason}; ${hint}`,
    );
    recordOperationalIssue({
      category: "media-decrypt-failed",
      messageId: msg.msgid ? String(msg.msgid) : undefined,
      summary: `${payload.scope} ${payload.kind} decrypt failed reason=${reason} url=${payload.url}`,
      raw: { transport: "bot-webhook", envelopeType: "json", body: msg },
      error: payload.error instanceof Error ? payload.error.message : String(payload.error),
    });
    const errorMessage =
      typeof payload.error === "object" && payload.error
        ? `${(payload.error as any).message}${(payload.error as any).cause ? ` (cause: ${String((payload.error as any).cause)})` : ""}`
        : String(payload.error);
    return { body: `${payload.bodyFallback} (decryption failed: ${errorMessage})` };
  };

  const tryDecryptMedia = async (payload: {
    kind: InboundMediaKind;
    url: string;
    explicitFilename?: string;
    aesKey?: string;
  }): Promise<BotInboundMedia> => {
    const urlHost = (() => { try { return new URL(payload.url).hostname; } catch { return "?"; } })();
    const t0 = Date.now();
    console.log(`[wecom-media] download-start kind=${payload.kind} host=${urlHost} aesKey=${payload.aesKey ? "payload" : "account"} timeoutMs=${mediaTimeoutMs} proxy=${proxyUrl || "none"}`);
    const decrypted = await decryptWecomMediaWithMeta(payload.url, payload.aesKey ?? aesKey, {
      maxBytes,
      http: { proxyUrl, timeoutMs: mediaTimeoutMs },
    });
    console.log(`[wecom-media] download-ok kind=${payload.kind} host=${urlHost} durationMs=${Date.now() - t0} bytes=${decrypted.buffer.length} contentType=${decrypted.sourceContentType ?? "?"}`);
    const inferred = inferInboundMediaMeta({
      kind: payload.kind === "image" ? "image" : "file",
      buffer: decrypted.buffer,
      sourceUrl: decrypted.sourceUrl || payload.url,
      sourceContentType: decrypted.sourceContentType,
      sourceFilename: decrypted.sourceFilename,
      explicitFilename: payload.explicitFilename,
    });
    return {
      buffer: decrypted.buffer,
      contentType: inferred.contentType,
      filename: inferred.filename,
    };
  };

  if (msgtype === "image") {
    const url = String((msg as any).image?.url ?? "").trim();
    if (url && aesKey) {
      try {
        const media = await tryDecryptMedia({
          kind: "image",
          url,
          explicitFilename: pickBotFileName(msg),
          aesKey: (msg as any).image?.aeskey,
        });
        return { body: "[image]", media };
      } catch (err) {
        return handleMediaFailure({
          scope: "inbound",
          kind: "image",
          url,
          error: err,
          bodyFallback: "[image]",
        });
      }
    }
  }

  if (msgtype === "file") {
    const url = String((msg as any).file?.url ?? "").trim();
    if (url && aesKey) {
      try {
        const media = await tryDecryptMedia({
          kind: "file",
          url,
          explicitFilename: pickBotFileName(msg),
          aesKey: (msg as any).file?.aeskey,
        });
        return { body: "[file]", media };
      } catch (err) {
        return handleMediaFailure({
          scope: "inbound",
          kind: "file",
          url,
          error: err,
          bodyFallback: "[file]",
        });
      }
    }
  }

  if (msgtype === "video") {
    const url = String((msg as any).video?.url ?? "").trim();
    if (url && aesKey) {
      try {
        const media = await tryDecryptMedia({
          kind: "video",
          url,
          explicitFilename: pickBotFileName(msg),
          aesKey: (msg as any).video?.aeskey,
        });
        return { body: "[video]", media };
      } catch (err) {
        return handleMediaFailure({
          scope: "inbound",
          kind: "video",
          url,
          error: err,
          bodyFallback: "[video]",
        });
      }
    }
  }

  if (msgtype === "mixed") {
    const items = (msg as any).mixed?.msg_item;
    if (Array.isArray(items)) {
      let foundMedia: BotInboundNormalizationResult["media"];
      const bodyParts: string[] = [];
      for (const item of items) {
        const t = String(item.msgtype ?? "").toLowerCase();
        if (t === "text") {
          const content = String(item.text?.content ?? "").trim();
          if (content) bodyParts.push(content);
          continue;
        }
        if ((t === "image" || t === "file" || t === "video") && !foundMedia && aesKey) {
          const mediaKind = t as InboundMediaKind;
          const url = String(item[mediaKind]?.url ?? "").trim();
          if (url) {
            try {
              foundMedia = await tryDecryptMedia({
                kind: mediaKind,
                url,
                explicitFilename: pickBotFileName(msg, item?.[mediaKind]),
                aesKey: item?.[mediaKind]?.aeskey,
              });
              bodyParts.push(`[${t}]`);
              continue;
            } catch (err) {
              const failed = handleMediaFailure({
                scope: "mixed",
                kind: mediaKind,
                url,
                error: err,
                bodyFallback: `[${t}]`,
              });
              bodyParts.push(failed.body);
              continue;
            }
          }
        }
        bodyParts.push(`[${t}]`);
      }
      return { body: bodyParts.join("\n"), media: foundMedia };
    }
  }

  if (msgtype === "text" || msgtype === "voice") {
    const baseBody = buildInboundBody(msg);
    // 新增支持：尝试从引用中提取候选媒体（支持 quote.image/file/video/mixed）
    // 优先级：顶层媒体已在上面处理，如果没有顶层媒体才检查引用
    const candidate = resolveQuoteMediaCandidate(msg);
    if (candidate?.url && aesKey) {
      const qHost = (() => { try { return new URL(candidate.url).hostname; } catch { return "?"; } })();
      console.log(`[wecom-media] quote-candidate msgtype=${msgtype} kind=${candidate.kind} host=${qHost} aesKey=${candidate.aesKey ? "payload" : "account"} msgid=${msg.msgid ?? "?"}`);
      try {
        // 尽快下载并解密媒体（应对 5 分钟 URL 时效窗口）
        const media = await tryDecryptMedia(candidate);
        return { body: baseBody, media };
      } catch (err) {
        // 下载或解密失败则降级，保留文本但记录失败原因便于调试
        const failed = handleMediaFailure({
          scope: "quote",
          kind: candidate.kind,
          url: candidate.url,
          error: err,
          bodyFallback: `${baseBody}\n[quote:${candidate.kind}]`,
        });
        return failed;
      }
    }
  }

  return { body: buildInboundBody(msg) };
}
