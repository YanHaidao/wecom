import crypto from "node:crypto";

import { resolveWecomEgressProxyUrlFromNetwork } from "../../config/index.js";
import { API_ENDPOINTS, LIMITS } from "../../types/constants.js";
import { wecomFetch } from "../../http.js";
import type { ResolvedAgentAccount } from "../../types/index.js";
import { guessUploadContentType, normalizeUploadFilename } from "./core.js";
import { getUpstreamAgentApiAccessToken } from "./client.js";

export async function uploadUpstreamAgentApiMedia(params: {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  type: "image" | "voice" | "video" | "file";
  buffer: Buffer;
  filename: string;
}): Promise<string> {
  const { upstreamAgent, primaryAgent, type, buffer, filename } = params;
  const safeFilename = normalizeUploadFilename(filename);
  
  // 使用下游企业的 access_token
  const token = await getUpstreamAgentApiAccessToken({
    primaryAgent,
    upstreamCorpId: upstreamAgent.corpId,
    upstreamAgentId: upstreamAgent.agentId!,
  });
  
  const proxyUrl = resolveWecomEgressProxyUrlFromNetwork(upstreamAgent.network);
  const url = `${API_ENDPOINTS.UPLOAD_MEDIA}?access_token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}&debug=1`;

  const uploadOnce = async (fileContentType: string) => {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(16).toString("hex")}`;
    const header = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="media"; filename="${safeFilename}"; filelength=${buffer.length}\r\n` +
        `Content-Type: ${fileContentType}\r\n\r\n`,
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, buffer, footer]);

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
    return json;
  };

  const preferredContentType = guessUploadContentType(safeFilename);
  let json = await uploadOnce(preferredContentType);

  if (!json?.media_id && preferredContentType !== "application/octet-stream") {
    console.warn(
      `[wecom-upstream-upload] Upload failed with ${preferredContentType}, retrying as application/octet-stream: ${json?.errcode} ${json?.errmsg}`,
    );
    json = await uploadOnce("application/octet-stream");
  }

  if (!json?.media_id) {
    throw new Error(`upload failed: ${json?.errcode} ${json?.errmsg}`);
  }
  return json.media_id;
}
