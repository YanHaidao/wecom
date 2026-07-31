import type { ResolvedAgentAccount } from "../../types/index.js";
import type { WecomTarget } from "../../target.js";
import { sendUpstreamAgentApiMarkdown, sendUpstreamAgentApiMedia, sendUpstreamAgentApiText } from "./client.js";
import type { AgentSendResult } from "./core.js";

export async function sendUpstreamAgentApiTextReply(params: {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  target: WecomTarget;
  text: string;
}): Promise<AgentSendResult> {
  return sendUpstreamAgentApiText({
    upstreamAgent: params.upstreamAgent,
    primaryAgent: params.primaryAgent,
    toUser: params.target.touser,
    toParty: params.target.toparty,
    toTag: params.target.totag,
    chatId: params.target.chatid,
    text: params.text,
  });
}

export async function sendUpstreamAgentApiMarkdownReply(params: {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  target: WecomTarget;
  text: string;
}): Promise<AgentSendResult> {
  return sendUpstreamAgentApiMarkdown({
    upstreamAgent: params.upstreamAgent,
    primaryAgent: params.primaryAgent,
    toUser: params.target.touser,
    toParty: params.target.toparty,
    toTag: params.target.totag,
    chatId: params.target.chatid,
    text: params.text,
  });
}

export async function sendUpstreamAgentApiMediaReply(params: {
  upstreamAgent: ResolvedAgentAccount;
  primaryAgent: ResolvedAgentAccount;
  target: WecomTarget;
  mediaId: string;
  mediaType: "image" | "voice" | "video" | "file";
  title?: string;
  description?: string;
}): Promise<AgentSendResult> {
  return sendUpstreamAgentApiMedia({
    upstreamAgent: params.upstreamAgent,
    primaryAgent: params.primaryAgent,
    toUser: params.target.touser,
    toParty: params.target.toparty,
    toTag: params.target.totag,
    chatId: params.target.chatid,
    mediaId: params.mediaId,
    mediaType: params.mediaType,
    title: params.title,
    description: params.description,
  });
}
