import type { ResolvedAgentAccount } from "../../types/index.js";
import {
  prepareWecomMarkdownChunks,
  prepareWecomTextChunks,
  type WecomMarkdownFormat,
} from "../../config/markdown.js";
import { resolveScopedWecomTarget } from "../../target.js";
import { deliverAgentApiMarkdown, deliverAgentApiMedia, deliverAgentApiText } from "../../transport/agent-api/delivery.js";
import { canUseAgentApiDelivery } from "./fallback-policy.js";
import { getWecomRuntime } from "../../runtime.js";
import { MESSAGE_BYTE_LIMITS } from "../../types/constants.js";

/**
 * 自建应用单条消息的上限，单位是 UTF-8 字节（text 与 markdown 同为 2048）。
 *
 * 名字里的 BYTE 是刻意的：此前这个常量叫 WECOM_TEXT_CHUNK_LIMIT 且被当作
 * 字符上限传给 chunkText，纯中文会超出企微限制 3 倍并被静默截断。
 */
export const WECOM_TEXT_CHUNK_BYTE_LIMIT = MESSAGE_BYTE_LIMITS.AGENT_MESSAGE;

export type WecomAgentDeliveryResult = {
  messageIds: string[];
};

export type WecomAgentSendTextParams = {
  to: string | undefined;
  text: string;
  /** 由调用方解析好的账号格式配置。 */
  format: WecomMarkdownFormat;
};

export class WecomAgentDeliveryService {
  constructor(private readonly agent: ResolvedAgentAccount) { }

  assertAvailable(): void {
    if (!canUseAgentApiDelivery(this.agent)) {
      throw new Error(
        `WeCom outbound requires channels.wecom.accounts.<accountId>.agent.agentId (or legacy channels.wecom.agent.agentId) for account=${this.agent.accountId}.`,
      );
    }
  }

  resolveTargetOrThrow(to: string | undefined) {
    const scoped = resolveScopedWecomTarget(to, this.agent.accountId);
    if (!scoped) {
      console.error(`[wecom-agent-delivery] missing target account=${this.agent.accountId}`);
      throw new Error("WeCom outbound requires a target (userid, partyid, tagid or chatid).");
    }
    if (scoped.accountId && scoped.accountId !== this.agent.accountId) {
      console.error(
        `[wecom-agent-delivery] account mismatch current=${this.agent.accountId} targetAccount=${scoped.accountId} raw=${String(to ?? "")}`,
      );
      throw new Error(
        `WeCom outbound account mismatch: target belongs to account=${scoped.accountId}, current account=${this.agent.accountId}.`,
      );
    }
    const target = scoped.target;
    if (target.chatid) {
      console.warn(
        `[wecom-agent-delivery] blocked chat target account=${this.agent.accountId} chatId=${target.chatid}`,
      );
      throw new Error(
        `企业微信（WeCom）Agent 主动发送不支持向群 chatId 发送（chatId=${target.chatid}）。` +
        `该路径在实际环境中经常失败（例如 86008：无权限访问该会话/会话由其他应用创建）。` +
        `请改为发送给用户（userid / user:xxx），或由 Bot 模式在群内交付。`,
      );
    }
    return target;
  }

  async sendText(params: WecomAgentSendTextParams): Promise<WecomAgentDeliveryResult> {
    this.assertAvailable();
    const target = this.resolveTargetOrThrow(params.to);
    const asMarkdown = params.format === "markdown";
    console.log(
      `[wecom-agent-delivery] sendText account=${this.agent.accountId} to=${String(params.to ?? "")} format=${params.format} len=${params.text.length}`,
    );

    const chunks = asMarkdown
      ? prepareWecomMarkdownChunks(params.text, WECOM_TEXT_CHUNK_BYTE_LIMIT)
      : prepareWecomTextChunks(params.text, WECOM_TEXT_CHUNK_BYTE_LIMIT, (value, charLimit) =>
          getWecomRuntime().channel.text.chunkText(value, charLimit),
        );

    const messageIds: string[] = [];
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const result = asMarkdown
        ? await deliverAgentApiMarkdown({ agent: this.agent, target, text: chunk })
        : await deliverAgentApiText({ agent: this.agent, target, text: chunk });
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
      `[wecom-agent-delivery] sendMedia account=${this.agent.accountId} to=${String(params.to ?? "")} filename=${params.filename} contentType=${params.contentType}`,
    );
    const result = await deliverAgentApiMedia({
      agent: this.agent,
      target,
      buffer: params.buffer,
      filename: params.filename,
      contentType: params.contentType,
      text: params.text,
    });
    return { messageIds: result?.msgid ? [result.msgid] : [] };
  }
}
