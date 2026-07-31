import type { ResolvedAgentAccount } from "../../types/index.js";
import type { WecomTarget } from "../../target.js";
import { sendUpstreamAgentApiMediaReply, sendUpstreamAgentApiTextReply } from "./upstream-reply.js";
import type { AgentSendResult } from "./core.js";

export async function deliverUpstreamAgentApiText(params: {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  target: WecomTarget;
  text: string;
}): Promise<AgentSendResult> {
  return sendUpstreamAgentApiTextReply(params);
}

export async function deliverUpstreamAgentApiMedia(params: {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  target: WecomTarget;
  buffer: Buffer;
  filename: string;
  contentType: string;
  text?: string;
}): Promise<AgentSendResult> {
  let mediaType: "image" | "voice" | "video" | "file" = "file";
  if (params.contentType.startsWith("image/")) mediaType = "image";
  else if (params.contentType.startsWith("audio/")) mediaType = "voice";
  else if (params.contentType.startsWith("video/")) mediaType = "video";

  const { uploadUpstreamAgentApiMedia } = await import("./upstream-media-upload.js");
  const mediaId = await uploadUpstreamAgentApiMedia({
    upstreamAgent: params.upstreamAgent,
    primaryAgent: params.primaryAgent,
    type: mediaType,
    buffer: params.buffer,
    filename: params.filename,
  });
  return sendUpstreamAgentApiMediaReply({
    upstreamAgent: params.upstreamAgent,
    primaryAgent: params.primaryAgent,
    target: params.target,
    mediaId,
    mediaType,
    title: mediaType === "video" ? params.text?.trim().slice(0, 64) : undefined,
    description: mediaType === "video" ? params.text?.trim().slice(0, 512) : undefined,
  });
}
