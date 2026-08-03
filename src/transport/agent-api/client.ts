import type { ResolvedAgentAccount } from "../../types/index.js";
import { API_ENDPOINTS, LIMITS } from "../../types/constants.js";
import {
  downloadMedia as downloadLegacyMedia,
  getAccessToken as getLegacyAccessToken,
  getUpstreamAccessToken as getLegacyUpstreamAccessToken,
  normalizeAgentSendResult,
  sendMarkdown as sendLegacyMarkdown,
  sendMedia as sendLegacyMedia,
  sendText as sendLegacyText,
  type AgentSendResult,
} from "./core.js";

export async function getAgentApiAccessToken(agent: ResolvedAgentAccount): Promise<string> {
  return getLegacyAccessToken(agent);
}

export async function getUpstreamAgentApiAccessToken(params: {
  primaryAgent: ResolvedAgentAccount;
  upstreamCorpId: string;
  upstreamAgentId: number;
}): Promise<string> {
  return getLegacyUpstreamAccessToken(params);
}

export async function sendAgentApiText(params: {
  agent: ResolvedAgentAccount;
  toUser?: string;
  toParty?: string;
  toTag?: string;
  chatId?: string;
  text: string;
}): Promise<AgentSendResult> {
  return sendLegacyText(params);
}

export async function sendAgentApiMarkdown(params: {
  agent: ResolvedAgentAccount;
  toUser?: string;
  toParty?: string;
  toTag?: string;
  chatId?: string;
  text: string;
}): Promise<AgentSendResult> {
  return sendLegacyMarkdown(params);
}

export async function sendAgentApiMedia(params: {
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
  return sendLegacyMedia(params);
}

export async function downloadAgentApiMedia(params: {
  agent: ResolvedAgentAccount;
  mediaId: string;
  maxBytes?: number;
}): Promise<{ buffer: Buffer; contentType: string; filename?: string }> {
  return downloadLegacyMedia(params);
}

export async function downloadUpstreamAgentApiMedia(params: {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  mediaId: string;
  maxBytes?: number;
}): Promise<{ buffer: Buffer; contentType: string; filename?: string }> {
  const { upstreamAgent, primaryAgent, mediaId, maxBytes } = params;

  const token = await getUpstreamAgentApiAccessToken({
    primaryAgent,
    upstreamCorpId: upstreamAgent.corpId,
    upstreamAgentId: upstreamAgent.agentId!,
  });
  const url = `${API_ENDPOINTS.DOWNLOAD_MEDIA}?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`;

  const { wecomFetch, readResponseBodyAsBuffer } = await import("../../http.js");
  const { resolveWecomEgressProxyUrlFromNetwork } = await import("../../config/index.js");

  const res = await wecomFetch(url, undefined, {
    proxyUrl: resolveWecomEgressProxyUrlFromNetwork(upstreamAgent.network),
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

  const buffer = await readResponseBodyAsBuffer(res, maxBytes);
  return { buffer, contentType, filename };
}

type UpstreamTarget = {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  toUser?: string;
  toParty?: string;
  toTag?: string;
  chatId?: string;
};

/**
 * 上下游企业消息发送的公共骨架：取下游 token、按目标选接口、POST、校验响应。
 *
 * 各 msgtype 只在 body 里的那一小块有差异，由 buildContent 提供；
 * 群会话（chatid）走 appchat/send，其余走 message/send。
 */
async function dispatchUpstreamAgentApi(params: {
  target: UpstreamTarget;
  msgtype: string;
  /** msgtype 对应的消息体片段，例如 `{ content: text }`。 */
  content: unknown;
  /** 错误信息里的动作名，用于区分 text / markdown / image 等。 */
  errorLabel?: string;
}): Promise<AgentSendResult> {
  const { upstreamAgent, primaryAgent, toUser, toParty, toTag, chatId } = params.target;
  const label = params.errorLabel ? `${params.errorLabel} ` : "";

  // 获取下游企业的 access_token
  const token = await getUpstreamAgentApiAccessToken({
    primaryAgent,
    upstreamCorpId: upstreamAgent.corpId,
    upstreamAgentId: upstreamAgent.agentId!,
  });

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
        agentid: upstreamAgent.agentId,
        [params.msgtype]: params.content,
      };

  const { wecomFetch } = await import("../../http.js");
  const { resolveWecomEgressProxyUrlFromNetwork } = await import("../../config/index.js");

  const res = await wecomFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    {
      proxyUrl: resolveWecomEgressProxyUrlFromNetwork(upstreamAgent.network),
      timeoutMs: LIMITS.REQUEST_TIMEOUT_MS,
    },
  );

  const json = (await res.json()) as {
    errcode?: number;
    errmsg?: string;
    invaliduser?: string;
    invalidparty?: string;
    invalidtag?: string;
    unlicenseduser?: string;
    msgid?: string;
    response_code?: string;
  };

  if (json?.errcode !== 0) {
    throw new Error(`send ${label}failed: ${json?.errcode} ${json?.errmsg}`);
  }

  // unlicenseduser 不在抓错条件里，理由见 core.ts 的 dispatchAgentApi。
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

/**
 * 发送文本消息给上下游用户
 * 使用下游企业的 access_token 和 agentId
 */
export async function sendUpstreamAgentApiText(params: {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  toUser?: string;
  toParty?: string;
  toTag?: string;
  chatId?: string;
  text: string;
}): Promise<AgentSendResult> {
  return dispatchUpstreamAgentApi({
    target: params,
    msgtype: "text",
    content: { content: params.text },
  });
}

/** 同 sendUpstreamAgentApiText，msgtype 为 markdown。 */
export async function sendUpstreamAgentApiMarkdown(params: {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  toUser?: string;
  toParty?: string;
  toTag?: string;
  /** 传了就抛错，理由见 core.ts sendMarkdown。 */
  chatId?: string;
  text: string;
}): Promise<AgentSendResult> {
  const { chatId, ...target } = params;
  if (chatId) {
    throw new Error(
      `send markdown failed: 企微 markdown 消息不支持群会话（chatId=${chatId}），` +
        `appchat/send 无 markdown msgtype。请对群目标改用 sendUpstreamAgentApiText。`,
    );
  }
  return dispatchUpstreamAgentApi({
    target,
    msgtype: "markdown",
    content: { content: params.text },
    errorLabel: "markdown",
  });
}

/**
 * 发送媒体消息给上下游用户
 * 使用下游企业的 access_token 和 agentId
 */
export async function sendUpstreamAgentApiMedia(params: {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  toUser?: string;
  toParty?: string;
  toTag?: string;
  chatId?: string;
  mediaId: string;
  mediaType: "image" | "voice" | "video" | "file";
  title?: string;
  description?: string;
}): Promise<AgentSendResult> {
  const { upstreamAgent, toUser, mediaId, mediaType, title, description } = params;

  console.log(
    `[wecom-upstream-api] sendMedia corpId=${upstreamAgent.corpId} agentId=${upstreamAgent.agentId} ` +
      `toUser=${toUser ?? ""} mediaType=${mediaType}`,
  );

  return dispatchUpstreamAgentApi({
    target: params,
    msgtype: mediaType,
    content:
      mediaType === "video"
        ? { media_id: mediaId, title: title ?? "Video", description: description ?? "" }
        : { media_id: mediaId },
    errorLabel: mediaType,
  });
}
