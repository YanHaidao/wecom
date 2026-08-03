import crypto from "node:crypto";

import { resolveWecomEgressProxyUrlFromNetwork } from "../../config/index.js";
import { readResponseBodyAsBuffer, wecomFetch } from "../../http.js";
import { API_ENDPOINTS, LIMITS } from "../../types/constants.js";
import type { ResolvedAgentAccount } from "../../types/index.js";

type TokenCache = {
  token: string;
  expiresAt: number;
  refreshPromise: Promise<string> | null;
};

const tokenCaches = new Map<string, TokenCache>();

function truncateForLog(raw: string, maxChars = 180): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars)}...(truncated)`;
}

export function normalizeUploadFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return "file.bin";
  const ext = trimmed.includes(".") ? `.${trimmed.split(".").pop()!.toLowerCase()}` : "";
  const base = ext ? trimmed.slice(0, -ext.length) : trimmed;
  const sanitizedBase = base
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\/;=]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeBase = sanitizedBase || "file";
  const safeExt = ext.replace(/[^a-z0-9.]/g, "");
  return `${safeBase}${safeExt || ".bin"}`;
}

export function guessUploadContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const contentTypeMap: Record<string, string> = {
    jpg: "image/jpg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    amr: "voice/amr",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    mp4: "video/mp4",
    mov: "video/quicktime",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    json: "application/json",
    xml: "application/xml",
    yaml: "application/yaml",
    yml: "application/yaml",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    rtf: "application/rtf",
    odt: "application/vnd.oasis.opendocument.text",
    zip: "application/zip",
    rar: "application/vnd.rar",
    "7z": "application/x-7z-compressed",
    gz: "application/gzip",
    tgz: "application/gzip",
    tar: "application/x-tar",
  };
  return contentTypeMap[ext] || "application/octet-stream";
}

function requireAgentId(agent: ResolvedAgentAccount): number {
  if (typeof agent.agentId === "number" && Number.isFinite(agent.agentId)) return agent.agentId;
  throw new Error(`wecom agent account=${agent.accountId} missing agentId; sending via cgi-bin/message/send requires agentId`);
}

/**
 * 获取主企业的 access_token
 * 使用 corpid + corpsecret
 */
export async function getAccessToken(agent: ResolvedAgentAccount): Promise<string> {
  const cacheKey = `${agent.corpId}:${String(agent.agentId ?? "na")}`;
  let cache = tokenCaches.get(cacheKey);

  if (!cache) {
    cache = { token: "", expiresAt: 0, refreshPromise: null };
    tokenCaches.set(cacheKey, cache);
  }

  const now = Date.now();
  if (cache.token && cache.expiresAt > now + LIMITS.TOKEN_REFRESH_BUFFER_MS) {
    return cache.token;
  }

  if (cache.refreshPromise) {
    return cache.refreshPromise;
  }

  cache.refreshPromise = (async () => {
    try {
      const url = `${API_ENDPOINTS.GET_TOKEN}?corpid=${encodeURIComponent(agent.corpId)}&corpsecret=${encodeURIComponent(agent.corpSecret)}`;
      
      const res = await wecomFetch(url, undefined, {
        proxyUrl: resolveWecomEgressProxyUrlFromNetwork(agent.network),
        timeoutMs: LIMITS.REQUEST_TIMEOUT_MS,
      });
      const json = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };

      if (!json?.access_token) {
        throw new Error(`gettoken failed: ${json?.errcode} ${json?.errmsg}`);
      }

      cache!.token = json.access_token;
      cache!.expiresAt = Date.now() + (json.expires_in ?? 7200) * 1000;
      return cache!.token;
    } finally {
      cache!.refreshPromise = null;
    }
  })();

  return cache.refreshPromise;
}

/**
 * 获取下游企业的 access_token
 * 
 * 根据企业微信文档：https://developer.work.weixin.qq.com/document/path/95816
 * 
 * 请求方式：POST（HTTPS）
 * 请求地址：https://qyapi.weixin.qq.com/cgi-bin/corpgroup/corp/gettoken?access_token=ACCESS_TOKEN
 * 
 * 请求体：
 * {
 *   "corpid": "下游企业corpid",
 *   "business_type": 1,  // 1 表示上下游企业
 *   "agentid": 下游企业应用ID
 * }
 * 
 * 注意：需要使用上游企业的 access_token 作为调用凭证
 */
export async function getUpstreamAccessToken(params: {
  primaryAgent: ResolvedAgentAccount;
  upstreamCorpId: string;
  upstreamAgentId: number;
}): Promise<string> {
  const { primaryAgent, upstreamCorpId, upstreamAgentId } = params;

  // 缓存 key 增加 primaryCorpId 维度，避免多主企业之间碰撞
  const cacheKey = `upstream:${primaryAgent.corpId}:${upstreamCorpId}:${upstreamAgentId}`;
  let cache = tokenCaches.get(cacheKey);

  if (!cache) {
    cache = { token: "", expiresAt: 0, refreshPromise: null };
    tokenCaches.set(cacheKey, cache);
  }

  const now = Date.now();
  if (cache.token && cache.expiresAt > now + LIMITS.TOKEN_REFRESH_BUFFER_MS) {
    return cache.token;
  }

  if (cache.refreshPromise) {
    return cache.refreshPromise;
  }

  cache.refreshPromise = (async () => {
    try {
      // 1. 先获取上游企业的 access_token
      const primaryToken = await getAccessToken(primaryAgent);

      // 2. 调用 corpgroup/corp/gettoken 获取下游企业的 access_token
      const url = `${API_ENDPOINTS.GET_UPSTREAM_TOKEN}?access_token=${encodeURIComponent(primaryToken)}`;
      
      const requestBody = {
        corpid: upstreamCorpId,
        business_type: 1,  // 1 表示上下游企业
        agentid: upstreamAgentId,
      };

      const res = await wecomFetch(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        },
        {
          proxyUrl: resolveWecomEgressProxyUrlFromNetwork(primaryAgent.network),
          timeoutMs: LIMITS.REQUEST_TIMEOUT_MS,
        },
      );
      
      const json = (await res.json()) as { 
        access_token?: string; 
        expires_in?: number; 
        errcode?: number; 
        errmsg?: string 
      };

      if (!json?.access_token) {
        throw new Error(`get upstream token failed: ${json?.errcode} ${json?.errmsg}`);
      }

      cache!.token = json.access_token;
      cache!.expiresAt = Date.now() + (json.expires_in ?? 7200) * 1000;
      return cache!.token;
    } finally {
      cache!.refreshPromise = null;
    }
  })();

  return cache.refreshPromise;
}

/**
 * 发送成功后唯一有价值的返回值。
 *
 * invaliduser / unlicenseduser 这类部分失败字段不在这里：它们出现即抛错，
 * 走到返回值的结果不可能带上它们。
 */
export type AgentSendResult = {
  msgid?: string;
};

/** 企微发送类接口的公共响应字段。 */
type WecomSendResponse = {
  errcode?: number;
  errmsg?: string;
  invaliduser?: string;
  invalidparty?: string;
  invalidtag?: string;
  unlicenseduser?: string;
  msgid?: string;
};

export function normalizeAgentSendResult(json: WecomSendResponse): AgentSendResult {
  return { msgid: json.msgid };
}

type AgentSendTarget = {
  agent: ResolvedAgentAccount;
  toUser?: string;
  toParty?: string;
  toTag?: string;
  chatId?: string;
};

/**
 * 自建应用消息发送的公共骨架：取 token、按目标选接口、POST、校验响应。
 *
 * 各 msgtype 只在 body 里的那一小块有差异，由 content 提供；
 * 群会话（chatid）走 appchat/send，其余走 message/send。
 */
async function dispatchAgentApi(params: {
  target: AgentSendTarget;
  msgtype: string;
  /** msgtype 对应的消息体片段，例如 `{ content: text }`。 */
  content: unknown;
  /** 错误信息里的动作名，用于区分 text / markdown / image 等。 */
  errorLabel?: string;
  /** 日志里的函数名；不传则不打日志（媒体路径历史上就没有）。 */
  logAs?: string;
  /** 追加到 request 日志末尾的细节，例如文本长度与预览。 */
  logDetail?: string;
}): Promise<AgentSendResult> {
  const { agent, toUser, toParty, toTag, chatId } = params.target;
  const label = params.errorLabel ? `${params.errorLabel} ` : "";
  const targetDesc = `toUser=${toUser ?? ""} toParty=${toParty ?? ""} toTag=${toTag ?? ""} chatId=${chatId ?? ""}`;
  const agentDesc = `account=${agent.accountId} agentId=${String(agent.agentId ?? "N/A")} corpId=${agent.corpId}`;

  if (params.logAs) {
    console.log(
      `[wecom-agent-api] ${params.logAs} request ${agentDesc} ${targetDesc}` +
        (params.logDetail ? ` ${params.logDetail}` : ""),
    );
  }

  const token = await getAccessToken(agent);

  const useChat = Boolean(chatId);
  const url = `${
    useChat ? API_ENDPOINTS.SEND_APPCHAT : API_ENDPOINTS.SEND_MESSAGE
  }?access_token=${encodeURIComponent(token)}`;

  const body = useChat
    ? { chatid: chatId, msgtype: params.msgtype, [params.msgtype]: params.content }
    : {
        touser: toUser,
        toparty: toParty,
        totag: toTag,
        msgtype: params.msgtype,
        agentid: requireAgentId(agent),
        [params.msgtype]: params.content,
      };

  const res = await wecomFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { proxyUrl: resolveWecomEgressProxyUrlFromNetwork(agent.network), timeoutMs: LIMITS.REQUEST_TIMEOUT_MS },
  );
  const json = (await res.json()) as WecomSendResponse;

  if (params.logAs) {
    console.log(
      `[wecom-agent-api] ${params.logAs} response ${agentDesc} ${targetDesc} ` +
        `errcode=${String(json?.errcode ?? "N/A")} errmsg=${json?.errmsg ?? ""} msgid=${json?.msgid ?? ""} ` +
        `invaliduser=${json?.invaliduser ?? ""} invalidparty=${json?.invalidparty ?? ""} ` +
        `invalidtag=${json?.invalidtag ?? ""} unlicenseduser=${json?.unlicenseduser ?? ""}`,
    );
  }

  if (json?.errcode !== 0) {
    throw new Error(`send ${label}failed: ${json?.errcode} ${json?.errmsg}`);
  }

  // unlicenseduser 不在抓错条件里：手册 90236 明确说它伴随 errcode=0 返回，
  // 且消息已经投递给了其余收件人（全员失败才是 81013）。当成失败抛出会
  // 让上层重试并重复投递，只需要上面那行日志能查到就够了。
  if (json?.invaliduser || json?.invalidparty || json?.invalidtag) {
    const details = [
      json.invaliduser ? `invaliduser=${json.invaliduser}` : "",
      json.invalidparty ? `invalidparty=${json.invalidparty}` : "",
      json.invalidtag ? `invalidtag=${json.invalidtag}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`send ${label}partial failure: ${details}`);
  }

  return normalizeAgentSendResult(json);
}

export async function sendText(params: {
  agent: ResolvedAgentAccount;
  toUser?: string;
  toParty?: string;
  toTag?: string;
  chatId?: string;
  text: string;
}): Promise<AgentSendResult> {
  return dispatchAgentApi({
    target: params,
    msgtype: "text",
    content: { content: params.text },
    logAs: "sendText",
    logDetail: `textLen=${params.text.length} textPreview=${JSON.stringify(truncateForLog(params.text))}`,
  });
}

export async function sendMarkdown(params: {
  agent: ResolvedAgentAccount;
  toUser?: string;
  toParty?: string;
  toTag?: string;
  /**
   * 企微 markdown 不支持 appchat/send，所以群会话目标无法用这个 msgtype 发送。
   * 传了就抛错：静默丢弃会让 body 里一个收件人字段都不剩，
   * 变成企微直接拒绝的空投递请求。调用方应改用 sendText。
   */
  chatId?: string;
  text: string;
}): Promise<AgentSendResult> {
  const { chatId, ...target } = params;
  if (chatId) {
    throw new Error(
      `send markdown failed: 企微 markdown 消息不支持群会话（chatId=${chatId}），` +
        `appchat/send 无 markdown msgtype。请对群目标改用 sendText。`,
    );
  }
  return dispatchAgentApi({
    target,
    msgtype: "markdown",
    content: { content: params.text },
    errorLabel: "markdown",
    logAs: "sendMarkdown",
    logDetail: `textLen=${params.text.length} textPreview=${JSON.stringify(truncateForLog(params.text))}`,
  });
}

export async function uploadMedia(params: {
  agent: ResolvedAgentAccount;
  type: "image" | "voice" | "video" | "file";
  buffer: Buffer;
  filename: string;
}): Promise<string> {
  const { agent, type, buffer, filename } = params;
  const safeFilename = normalizeUploadFilename(filename);
  const token = await getAccessToken(agent);
  const proxyUrl = resolveWecomEgressProxyUrlFromNetwork(agent.network);
  const url = `${API_ENDPOINTS.UPLOAD_MEDIA}?access_token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}&debug=1`;

  console.log(`[wecom-upload] Uploading media: type=${type}, filename=${safeFilename}, size=${buffer.length} bytes, corpId=${agent.corpId}`);

  const uploadOnce = async (fileContentType: string) => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(16).toString("hex")}`;
    const header = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="media"; filename="${safeFilename}"; filelength=${buffer.length}\r\n` +
        `Content-Type: ${fileContentType}\r\n\r\n`,
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, buffer, footer]);

    console.log(`[wecom-upload] Multipart body size=${body.length}, boundary=${boundary}, fileContentType=${fileContentType}`);

    const res = await wecomFetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
        body,
      },
      { proxyUrl, timeoutMs: LIMITS.REQUEST_TIMEOUT_MS },
    );
    const json = (await res.json()) as { media_id?: string; errcode?: number; errmsg?: string };
    console.log(`[wecom-upload] Response:`, JSON.stringify(json));
    return json;
  };

  const preferredContentType = guessUploadContentType(safeFilename);
  let json = await uploadOnce(preferredContentType);

  if (!json?.media_id && preferredContentType !== "application/octet-stream") {
    console.warn(
      `[wecom-upload] Upload failed with ${preferredContentType}, retrying as application/octet-stream: ${json?.errcode} ${json?.errmsg}`,
    );
    json = await uploadOnce("application/octet-stream");
  }

  if (!json?.media_id) {
    throw new Error(`upload failed: ${json?.errcode} ${json?.errmsg}`);
  }
  return json.media_id;
}

export async function sendMedia(params: {
  agent: ResolvedAgentAccount;
  toUser?: string;
  toParty?: string;
  toTag?: string;
  chatId?: string;
  mediaId: string;
  mediaType: "image" | "voice" | "video" | "file";
  title?: string;
  description?: string;
}): Promise<AgentSendResult> {
  const { mediaId, mediaType, title, description } = params;
  return dispatchAgentApi({
    target: params,
    msgtype: mediaType,
    content:
      mediaType === "video"
        ? { media_id: mediaId, title: title ?? "Video", description: description ?? "" }
        : { media_id: mediaId },
    errorLabel: mediaType,
  });
}

export async function downloadMedia(params: {
  agent: ResolvedAgentAccount;
  mediaId: string;
  maxBytes?: number;
}): Promise<{ buffer: Buffer; contentType: string; filename?: string }> {
  const { agent, mediaId } = params;
  const token = await getAccessToken(agent);
  const url = `${API_ENDPOINTS.DOWNLOAD_MEDIA}?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`;

  const res = await wecomFetch(url, undefined, {
    proxyUrl: resolveWecomEgressProxyUrlFromNetwork(agent.network),
    timeoutMs: LIMITS.REQUEST_TIMEOUT_MS,
  });

  if (!res.ok) {
    throw new Error(`download failed: ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const disposition = res.headers.get("content-disposition") || "";
  const filename = (() => {
    const mStar = disposition.match(/filename\*\s*=\s*([^;]+)/i);
    if (mStar) {
      const raw = mStar[1]!.trim().replace(/^"(.*)"$/, "$1");
      const parts = raw.split("''");
      const encoded = parts.length === 2 ? parts[1]! : raw;
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    }
    const m = disposition.match(/filename\s*=\s*([^;]+)/i);
    if (!m) return undefined;
    return m[1]!.trim().replace(/^"(.*)"$/, "$1") || undefined;
  })();

  if (contentType.includes("application/json")) {
    const json = (await res.json()) as { errcode?: number; errmsg?: string };
    throw new Error(`download failed: ${json?.errcode} ${json?.errmsg}`);
  }

  const buffer = await readResponseBodyAsBuffer(res, params.maxBytes);
  return { buffer, contentType, filename };
}
