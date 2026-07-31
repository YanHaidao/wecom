import type { ResolvedAgentAccount } from "../../types/index.js";
import { prepareWecomMarkdownChunks, prepareWecomTextChunks } from "../../config/markdown.js";
import { getWecomRuntime } from "../../runtime.js";
import { resolveScopedWecomTarget } from "../../target.js";
import { deliverUpstreamAgentApiMarkdown, deliverUpstreamAgentApiMedia, deliverUpstreamAgentApiText } from "../../transport/agent-api/upstream-delivery.js";
import { canUseAgentApiDelivery } from "./fallback-policy.js";
import {
  WECOM_TEXT_CHUNK_BYTE_LIMIT,
  type WecomAgentDeliveryResult,
  type WecomAgentSendTextParams,
} from "./delivery-service.js";

/**
 * 上下游企业消息发送服务
 * 
 * 使用下游企业的 access_token 和 agentId 发送消息
 */
export class WecomUpstreamAgentDeliveryService {
  constructor(
    private readonly upstreamAgent: ResolvedAgentAccount,
    private readonly primaryAgent: ResolvedAgentAccount,
  ) { }

  assertAvailable(): void {
    if (!canUseAgentApiDelivery(this.upstreamAgent)) {
      throw new Error(
        `WeCom upstream outbound requires channels.wecom.accounts.<accountId>.agent.agentId for upstream corp=${this.upstreamAgent.corpId}.`,
      );
    }
  }

  resolveTargetOrThrow(to: string | undefined) {
    const scoped = resolveScopedWecomTarget(to, this.upstreamAgent.accountId);
    if (!scoped) {
      console.error(`[wecom-upstream-delivery] missing target account=${this.upstreamAgent.accountId}`);
      throw new Error("WeCom upstream outbound requires a target (userid, partyid, tagid or chatid).");
    }
    if (scoped.accountId && scoped.accountId !== this.upstreamAgent.accountId) {
      console.error(
        `[wecom-upstream-delivery] account mismatch current=${this.upstreamAgent.accountId} targetAccount=${scoped.accountId} raw=${String(to ?? "")}`,
      );
      throw new Error(
        `WeCom upstream outbound account mismatch: target belongs to account=${scoped.accountId}, current account=${this.upstreamAgent.accountId}.`,
      );
    }
    const target = scoped.target;
    if (target.chatid) {
      console.warn(
        `[wecom-upstream-delivery] blocked chat target account=${this.upstreamAgent.accountId} chatId=${target.chatid}`,
      );
      throw new Error(
        `企业微信（WeCom）上下游 Agent 主动发送不支持向群 chatId 发送（chatId=${target.chatid}）。` +
        `请改为发送给用户（userid / user:xxx）。`,
      );
    }
    return target;
  }

  async sendText(params: WecomAgentSendTextParams): Promise<WecomAgentDeliveryResult> {
    this.assertAvailable();
    const target = this.resolveTargetOrThrow(params.to);
    const asMarkdown = params.format === "markdown";
    console.log(
      `[wecom-upstream-delivery] sendText account=${this.upstreamAgent.accountId} corpId=${this.upstreamAgent.corpId} to=${String(params.to ?? "")} format=${params.format} len=${params.text.length}`,
    );

    const chunks = asMarkdown
      ? prepareWecomMarkdownChunks(params.text, WECOM_TEXT_CHUNK_BYTE_LIMIT)
      : prepareWecomTextChunks(params.text, WECOM_TEXT_CHUNK_BYTE_LIMIT, (value, charLimit) =>
          getWecomRuntime().channel.text.chunkText(value, charLimit),
        );

    const messageIds: string[] = [];
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const result =
        asMarkdown
          ? await deliverUpstreamAgentApiMarkdown({
              upstreamAgent: this.upstreamAgent,
              primaryAgent: this.primaryAgent,
              target,
              text: chunk,
            })
          : await deliverUpstreamAgentApiText({
              upstreamAgent: this.upstreamAgent,
              primaryAgent: this.primaryAgent,
              target,
              text: chunk,
            });
      if (result?.msgid) messageIds.push(result.msgid);
    }

    return { messageIds };
  }

  async sendMedia(params: {
    to: string | undefined;
    text?: string;
    buffer: Buffer;
    filename: string;
    contentType: string;
  }): Promise<WecomAgentDeliveryResult> {
    this.assertAvailable();
    const target = this.resolveTargetOrThrow(params.to);
    console.log(
      `[wecom-upstream-delivery] sendMedia account=${this.upstreamAgent.accountId} corpId=${this.upstreamAgent.corpId} to=${String(params.to ?? "")} filename=${params.filename} contentType=${params.contentType}`,
    );
    const result = await deliverUpstreamAgentApiMedia({
      upstreamAgent: this.upstreamAgent,
      primaryAgent: this.primaryAgent,
      target,
      buffer: params.buffer,
      filename: params.filename,
      contentType: params.contentType,
      text: params.text,
    });
    return { messageIds: result?.msgid ? [result.msgid] : [] };
  }
}
