/**
 * WeCom Agent API 客户端
 * 管理 AccessToken 缓存和 API 调用
 */

import crypto from "node:crypto";
import { API_ENDPOINTS, LIMITS } from "../types/constants.js";
import type { ResolvedAgentAccount } from "../types/index.js";

type TokenCache = {
    token: string;
    expiresAt: number;
    refreshPromise: Promise<string> | null;
};

const tokenCaches = new Map<string, TokenCache>();

/**
 * 获取 AccessToken (带缓存)
 */
export async function getAccessToken(agent: ResolvedAgentAccount): Promise<string> {
    const cacheKey = `${agent.corpId}:${agent.agentId}`;
    let cache = tokenCaches.get(cacheKey);

    if (!cache) {
        cache = { token: "", expiresAt: 0, refreshPromise: null };
        tokenCaches.set(cacheKey, cache);
    }

    const now = Date.now();
    if (cache.token && cache.expiresAt > now + LIMITS.TOKEN_REFRESH_BUFFER_MS) {
        return cache.token;
    }

    // 防止并发刷新
    if (cache.refreshPromise) {
        return cache.refreshPromise;
    }

    cache.refreshPromise = (async () => {
        try {
            const url = `${API_ENDPOINTS.GET_TOKEN}?corpid=${encodeURIComponent(agent.corpId)}&corpsecret=${encodeURIComponent(agent.corpSecret)}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(LIMITS.REQUEST_TIMEOUT_MS) });
            const json = await res.json() as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };

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
 * 发送文本消息
 */
export async function sendText(params: {
    agent: ResolvedAgentAccount;
    toUser?: string;
    chatId?: string;
    text: string;
}): Promise<void> {
    const { agent, toUser, chatId, text } = params;
    const token = await getAccessToken(agent);

    const useChat = Boolean(chatId);
    const url = useChat
        ? `${API_ENDPOINTS.SEND_APPCHAT}?access_token=${encodeURIComponent(token)}`
        : `${API_ENDPOINTS.SEND_MESSAGE}?access_token=${encodeURIComponent(token)}`;

    const body = useChat
        ? { chatid: chatId, msgtype: "text", text: { content: text } }
        : { touser: toUser, msgtype: "text", agentid: agent.agentId, text: { content: text } };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(LIMITS.REQUEST_TIMEOUT_MS),
    });
    const json = await res.json() as { errcode?: number; errmsg?: string };

    if (json?.errcode !== 0) {
        throw new Error(`send failed: ${json?.errcode} ${json?.errmsg}`);
    }
}

/**
 * 上传媒体文件
 */
export async function uploadMedia(params: {
    agent: ResolvedAgentAccount;
    type: "image" | "voice" | "video" | "file";
    buffer: Buffer;
    filename: string;
}): Promise<string> {
    const { agent, type, buffer, filename } = params;
    const token = await getAccessToken(agent);
    // 添加 debug=1 参数获取更多错误信息
    const url = `${API_ENDPOINTS.UPLOAD_MEDIA}?access_token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}&debug=1`;

    // DEBUG: 输出上传信息
    console.log(`[wecom-upload] Uploading media: type=${type}, filename=${filename}, size=${buffer.length} bytes`);

    // 手动构造 multipart/form-data 请求体
    // 企业微信要求包含 filename 和 filelength
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(16).toString("hex")}`;

    // 根据文件类型设置 Content-Type
    const contentTypeMap: Record<string, string> = {
        jpg: "image/jpg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
        bmp: "image/bmp", amr: "voice/amr", mp4: "video/mp4",
    };
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const fileContentType = contentTypeMap[ext] || "application/octet-stream";

    // 构造 multipart body
    const header = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="media"; filename="${filename}"; filelength=${buffer.length}\r\n` +
        `Content-Type: ${fileContentType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, buffer, footer]);

    console.log(`[wecom-upload] Multipart body size=${body.length}, boundary=${boundary}, fileContentType=${fileContentType}`);

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": String(body.length),
        },
        body: body,
        signal: AbortSignal.timeout(LIMITS.REQUEST_TIMEOUT_MS),
    });
    const json = await res.json() as { media_id?: string; errcode?: number; errmsg?: string };

    // DEBUG: 输出完整响应
    console.log(`[wecom-upload] Response:`, JSON.stringify(json));

    if (!json?.media_id) {
        throw new Error(`upload failed: ${json?.errcode} ${json?.errmsg}`);
    }
    return json.media_id;
}

/**
 * 发送媒体消息
 */
export async function sendMedia(params: {
    agent: ResolvedAgentAccount;
    toUser?: string;
    chatId?: string;
    mediaId: string;
    mediaType: "image" | "voice" | "video" | "file";
    title?: string;
    description?: string;
}): Promise<void> {
    const { agent, toUser, chatId, mediaId, mediaType, title, description } = params;
    const token = await getAccessToken(agent);

    const useChat = Boolean(chatId);
    const url = useChat
        ? `${API_ENDPOINTS.SEND_APPCHAT}?access_token=${encodeURIComponent(token)}`
        : `${API_ENDPOINTS.SEND_MESSAGE}?access_token=${encodeURIComponent(token)}`;

    const mediaPayload = mediaType === "video"
        ? { media_id: mediaId, title: title ?? "Video", description: description ?? "" }
        : { media_id: mediaId };

    const body = useChat
        ? { chatid: chatId, msgtype: mediaType, [mediaType]: mediaPayload }
        : { touser: toUser, msgtype: mediaType, agentid: agent.agentId, [mediaType]: mediaPayload };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(LIMITS.REQUEST_TIMEOUT_MS),
    });
    const json = await res.json() as { errcode?: number; errmsg?: string };

    if (json?.errcode !== 0) {
        throw new Error(`send ${mediaType} failed: ${json?.errcode} ${json?.errmsg}`);
    }
}

/**
 * 下载媒体文件
 */
export async function downloadMedia(params: {
    agent: ResolvedAgentAccount;
    mediaId: string;
}): Promise<{ buffer: Buffer; contentType: string }> {
    const { agent, mediaId } = params;
    const token = await getAccessToken(agent);
    const url = `${API_ENDPOINTS.DOWNLOAD_MEDIA}?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`;

    const res = await fetch(url, {
        signal: AbortSignal.timeout(LIMITS.REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
        throw new Error(`download failed: ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";

    // 检查是否返回了错误 JSON
    if (contentType.includes("application/json")) {
        const json = await res.json() as { errcode?: number; errmsg?: string };
        throw new Error(`download failed: ${json?.errcode} ${json?.errmsg}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
}
