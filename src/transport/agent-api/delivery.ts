import type { ResolvedAgentAccount } from "../../types/index.js";
import type { WecomTarget } from "../../target.js";
import { sendAgentApiMarkdownReply, sendAgentApiMediaReply, sendAgentApiTextReply } from "./reply.js";
import { uploadAgentApiMedia } from "./media-upload.js";
import type { AgentSendResult } from "./core.js";

export async function deliverAgentApiText(params: {
  agent: ResolvedAgentAccount;
  target: WecomTarget;
  text: string;
}): Promise<AgentSendResult> {
  return sendAgentApiTextReply(params);
}

export async function deliverAgentApiMarkdown(params: {
  agent: ResolvedAgentAccount;
  target: WecomTarget;
  text: string;
}): Promise<AgentSendResult> {
  return sendAgentApiMarkdownReply(params);
}

export async function deliverAgentApiMedia(params: {
  agent: ResolvedAgentAccount;
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

  const mediaId = await uploadAgentApiMedia({
    agent: params.agent,
    type: mediaType,
    buffer: params.buffer,
    filename: params.filename,
  });
  return sendAgentApiMediaReply({
    agent: params.agent,
    target: params.target,
    mediaId,
    mediaType,
    title: mediaType === "video" ? params.text?.trim().slice(0, 64) : undefined,
    description: mediaType === "video" ? params.text?.trim().slice(0, 512) : undefined,
  });
}
