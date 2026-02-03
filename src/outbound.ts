import type { ChannelOutboundAdapter, ChannelOutboundContext } from "openclaw/plugin-sdk";

import { sendText as sendAgentText, sendMedia as sendAgentMedia, uploadMedia } from "./agent/api-client.js";
import { resolveWecomAccounts } from "./config/index.js";
import { getWecomRuntime } from "./runtime.js";

function normalizeWecomOutboundTarget(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return undefined;
  return trimmed.replace(/^(wecom|wechatwork|wework|qywx):/i, "").trim() || undefined;
}

function resolveAgentConfigOrThrow(cfg: ChannelOutboundContext["cfg"]) {
  const account = resolveWecomAccounts(cfg).agent;
  if (!account?.configured) {
    throw new Error(
      "WeCom outbound requires Agent mode. Configure channels.wecom.agent (corpId/corpSecret/agentId/token/encodingAESKey).",
    );
  }
  // DEBUG: 输出使用的 Agent 配置信息
  console.log(`[wecom-outbound] Using agent config: corpId=${account.corpId}, agentId=${account.agentId}, corpSecret=${account.corpSecret?.slice(0, 8)}...`);
  return account;
}

export const wecomOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunkerMode: "text",
  textChunkLimit: 20480,
  chunker: (text, limit) => {
    try {
      return getWecomRuntime().channel.text.chunkText(text, limit);
    } catch {
      return [text];
    }
  },
  sendText: async ({ cfg, to, text, signal }: ChannelOutboundContext) => {
    if (signal?.aborted) {
      throw new Error("Outbound delivery aborted");
    }

    const agent = resolveAgentConfigOrThrow(cfg);
    const targetId = normalizeWecomOutboundTarget(to);
    if (!targetId) {
      throw new Error("WeCom outbound requires a target (userid or chatid).");
    }

    const isChat = /^(wr|wc)/i.test(targetId);
    await sendAgentText({
      agent,
      toUser: isChat ? undefined : targetId,
      chatId: isChat ? targetId : undefined,
      text,
    });

    return {
      channel: "wecom",
      messageId: `agent-${Date.now()}`,
      timestamp: Date.now(),
    };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, signal }: ChannelOutboundContext) => {
    if (signal?.aborted) {
      throw new Error("Outbound delivery aborted");
    }

    const agent = resolveAgentConfigOrThrow(cfg);
    const targetId = normalizeWecomOutboundTarget(to);
    if (!targetId) {
      throw new Error("WeCom outbound requires a target (userid or chatid).");
    }
    if (!mediaUrl) {
      throw new Error("WeCom outbound requires mediaUrl.");
    }

    let buffer: Buffer;
    let contentType: string;
    let filename: string;

    // 判断是 URL 还是本地文件路径
    const isRemoteUrl = /^https?:\/\//i.test(mediaUrl);

    if (isRemoteUrl) {
      const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        throw new Error(`Failed to download media: ${res.status}`);
      }
      buffer = Buffer.from(await res.arrayBuffer());
      contentType = res.headers.get("content-type") || "application/octet-stream";
      const urlPath = new URL(mediaUrl).pathname;
      filename = urlPath.split("/").pop() || "media";
    } else {
      // 本地文件路径
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      buffer = await fs.readFile(mediaUrl);
      filename = path.basename(mediaUrl);

      // 根据扩展名推断 content-type
      const ext = path.extname(mediaUrl).slice(1).toLowerCase();
      const mimeTypes: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
        webp: "image/webp", bmp: "image/bmp", mp3: "audio/mpeg", wav: "audio/wav",
        amr: "audio/amr", mp4: "video/mp4", pdf: "application/pdf", doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      contentType = mimeTypes[ext] || "application/octet-stream";
      console.log(`[wecom-outbound] Reading local file: ${mediaUrl}, ext=${ext}, contentType=${contentType}`);
    }

    let mediaType: "image" | "voice" | "video" | "file" = "file";
    if (contentType.startsWith("image/")) mediaType = "image";
    else if (contentType.startsWith("audio/")) mediaType = "voice";
    else if (contentType.startsWith("video/")) mediaType = "video";

    const mediaId = await uploadMedia({
      agent,
      type: mediaType,
      buffer,
      filename,
    });

    const isChat = /^(wr|wc)/i.test(targetId);
    await sendAgentMedia({
      agent,
      toUser: isChat ? undefined : targetId,
      chatId: isChat ? targetId : undefined,
      mediaId,
      mediaType,
      ...(mediaType === "video" && text?.trim()
        ? {
          title: text.trim().slice(0, 64),
          description: text.trim().slice(0, 512),
        }
        : {}),
    });

    return {
      channel: "wecom",
      messageId: `agent-media-${Date.now()}`,
      timestamp: Date.now(),
    };
  },
};
