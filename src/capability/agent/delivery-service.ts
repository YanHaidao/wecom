import type { ResolvedAgentAccount } from "../../types/index.js";
import {
  prepareWecomMarkdownChunks,
  prepareWecomTextChunks,
  type WecomMarkdownFormat,
} from "../../config/markdown.js";
import { resolveScopedWecomTarget, type WecomTarget } from "../../target.js";
import { deliverAgentApiMarkdown, deliverAgentApiMedia, deliverAgentApiText } from "../../transport/agent-api/delivery.js";
import type { AgentSendResult } from "../../transport/agent-api/core.js";
import { canUseAgentApiDelivery } from "./fallback-policy.js";
import { getWecomRuntime } from "../../runtime.js";
import { utf8ByteLength } from "../../shared/byte-chunking.js";
import { createSendPacer } from "../../shared/send-pacing.js";
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

export type WecomAgentSendMediaParams = {
  to: string | undefined;
  text?: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
};

/**
 * 两条 Agent 投递路径（普通自建应用 / 上下游企业）的公共骨架。
 *
 * 两者的**接口完全相同**，差别只在用哪个 access_token 与哪个 agentid——
 * 手册 93360「使用API接口」：① 取上级企业 access_token ② 取下级企业
 * access_token ③ 用第②步的下级 token 调用同样的 API 接口。取 token 的
 * 差异已经收在 transport/agent-api 的 AgentApiAuth 里，这一层不必再分叉。
 *
 * 所以分片、字节日志、发送节流、msgid 收集都放在这里，子类只提供账号、
 * 日志前缀、几句错误文案和三个 deliver 入口。
 */
export abstract class WecomAgentDeliveryBase {
  /** 目标解析、可用性判断与日志都按这个账号算；上下游场景下是**下游**账号。 */
  protected abstract readonly account: ResolvedAgentAccount;
  /** 日志前缀，例如 `wecom-agent-delivery`。 */
  protected abstract readonly logPrefix: string;
  /** 错误文案里的路径名，例如 `WeCom outbound`。 */
  protected abstract readonly scopeLabel: string;
  /** agentId 缺失时的报错信息：两条路径的配置项提示不同。 */
  protected abstract unavailableMessage(): string;
  /** 群目标被拒时的报错信息：两条路径的补充说明不同。 */
  protected abstract blockedChatMessage(chatId: string): string;

  protected abstract deliverText(target: WecomTarget, text: string): Promise<AgentSendResult>;
  protected abstract deliverMarkdown(target: WecomTarget, text: string): Promise<AgentSendResult>;
  protected abstract deliverMedia(
    target: WecomTarget,
    params: WecomAgentSendMediaParams,
  ): Promise<AgentSendResult>;

  assertAvailable(): void {
    if (!canUseAgentApiDelivery(this.account)) {
      throw new Error(this.unavailableMessage());
    }
  }

  resolveTargetOrThrow(to: string | undefined): WecomTarget {
    const { accountId } = this.account;
    const scoped = resolveScopedWecomTarget(to, accountId);
    if (!scoped) {
      console.error(`[${this.logPrefix}] missing target account=${accountId}`);
      throw new Error(`${this.scopeLabel} requires a target (userid, partyid, tagid or chatid).`);
    }
    if (scoped.accountId && scoped.accountId !== accountId) {
      console.error(
        `[${this.logPrefix}] account mismatch current=${accountId} targetAccount=${scoped.accountId} raw=${String(to ?? "")}`,
      );
      throw new Error(
        `${this.scopeLabel} account mismatch: target belongs to account=${scoped.accountId}, current account=${accountId}.`,
      );
    }
    const target = scoped.target;
    if (target.chatid) {
      console.warn(
        `[${this.logPrefix}] blocked chat target account=${accountId} chatId=${target.chatid}`,
      );
      throw new Error(this.blockedChatMessage(target.chatid));
    }
    return target;
  }

  async sendText(params: WecomAgentSendTextParams): Promise<WecomAgentDeliveryResult> {
    this.assertAvailable();
    const target = this.resolveTargetOrThrow(params.to);
    const asMarkdown = params.format === "markdown";
    const chunks = asMarkdown
      ? prepareWecomMarkdownChunks(params.text, WECOM_TEXT_CHUNK_BYTE_LIMIT)
      : prepareWecomTextChunks(params.text, WECOM_TEXT_CHUNK_BYTE_LIMIT, (value, charLimit) =>
          getWecomRuntime().channel.text.chunkText(value, charLimit),
        );

    // 字节数与分片数一起打：企微按字节限长，只看字符数无法判断是否会被截断。
    console.log(
      `[${this.logPrefix}] sendText account=${this.account.accountId} corpId=${this.account.corpId} ` +
        `to=${String(params.to ?? "")} format=${params.format} chars=${params.text.length} ` +
        `bytes=${utf8ByteLength(params.text)} chunks=${chunks.length} ` +
        `chunkBytes=[${chunks.map((c) => utf8ByteLength(c)).join(",")}]`,
    );

    const messageIds: string[] = [];
    // 隔开相邻两片：企微不保证同一收件人连续多条消息的投递顺序。
    const pace = createSendPacer();
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      await pace();
      const result = asMarkdown
        ? await this.deliverMarkdown(target, chunk)
        : await this.deliverText(target, chunk);
      if (result?.msgid) messageIds.push(result.msgid);
    }

    return { messageIds };
  }

  async sendMedia(params: WecomAgentSendMediaParams): Promise<WecomAgentDeliveryResult> {
    this.assertAvailable();
    const target = this.resolveTargetOrThrow(params.to);
    console.log(
      `[${this.logPrefix}] sendMedia account=${this.account.accountId} corpId=${this.account.corpId} ` +
        `to=${String(params.to ?? "")} filename=${params.filename} contentType=${params.contentType}`,
    );
    const result = await this.deliverMedia(target, params);
    return { messageIds: result?.msgid ? [result.msgid] : [] };
  }
}

export class WecomAgentDeliveryService extends WecomAgentDeliveryBase {
  protected readonly logPrefix = "wecom-agent-delivery";
  protected readonly scopeLabel = "WeCom outbound";

  constructor(protected readonly account: ResolvedAgentAccount) {
    super();
  }

  protected unavailableMessage(): string {
    return `WeCom outbound requires channels.wecom.accounts.<accountId>.agent.agentId (or legacy channels.wecom.agent.agentId) for account=${this.account.accountId}.`;
  }

  protected blockedChatMessage(chatId: string): string {
    return (
      `企业微信（WeCom）Agent 主动发送不支持向群 chatId 发送（chatId=${chatId}）。` +
      `该路径在实际环境中经常失败（例如 86008：无权限访问该会话/会话由其他应用创建）。` +
      `请改为发送给用户（userid / user:xxx），或由 Bot 模式在群内交付。`
    );
  }

  protected deliverText(target: WecomTarget, text: string): Promise<AgentSendResult> {
    return deliverAgentApiText({ agent: this.account, target, text });
  }

  protected deliverMarkdown(target: WecomTarget, text: string): Promise<AgentSendResult> {
    return deliverAgentApiMarkdown({ agent: this.account, target, text });
  }

  protected deliverMedia(
    target: WecomTarget,
    params: WecomAgentSendMediaParams,
  ): Promise<AgentSendResult> {
    return deliverAgentApiMedia({
      agent: this.account,
      target,
      buffer: params.buffer,
      filename: params.filename,
      contentType: params.contentType,
      text: params.text,
    });
  }
}
