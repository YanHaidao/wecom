import type { ResolvedAgentAccount } from "../../types/index.js";
import type { WecomTarget } from "../../target.js";
import type { AgentSendResult } from "../../transport/agent-api/core.js";
import {
  deliverUpstreamAgentApiMarkdown,
  deliverUpstreamAgentApiMedia,
  deliverUpstreamAgentApiText,
} from "../../transport/agent-api/upstream-delivery.js";
import { WecomAgentDeliveryBase, type WecomAgentSendMediaParams } from "./delivery-service.js";

/**
 * 上下游企业消息发送服务。
 *
 * 只提供「用下游企业的 access_token 和 agentId 发」这一点差异，分片、节流、
 * 日志与错误处理都复用 WecomAgentDeliveryBase——手册 93360 说明上下游用的是
 * 同一套 API，区别仅在 token。
 */
export class WecomUpstreamAgentDeliveryService extends WecomAgentDeliveryBase {
  protected readonly logPrefix = "wecom-upstream-delivery";
  protected readonly scopeLabel = "WeCom upstream outbound";

  constructor(
    /** 下游企业账号，基类的 account 就是它。 */
    protected readonly account: ResolvedAgentAccount,
    /** 上级企业账号，仅用于换取下游 token。 */
    private readonly primaryAgent: ResolvedAgentAccount,
  ) {
    super();
  }

  protected unavailableMessage(): string {
    return `WeCom upstream outbound requires channels.wecom.accounts.<accountId>.agent.agentId for upstream corp=${this.account.corpId}.`;
  }

  protected blockedChatMessage(chatId: string): string {
    return (
      `企业微信（WeCom）上下游 Agent 主动发送不支持向群 chatId 发送（chatId=${chatId}）。` +
      `请改为发送给用户（userid / user:xxx）。`
    );
  }

  protected deliverText(target: WecomTarget, text: string): Promise<AgentSendResult> {
    return deliverUpstreamAgentApiText({
      upstreamAgent: this.account,
      primaryAgent: this.primaryAgent,
      target,
      text,
    });
  }

  protected deliverMarkdown(target: WecomTarget, text: string): Promise<AgentSendResult> {
    return deliverUpstreamAgentApiMarkdown({
      upstreamAgent: this.account,
      primaryAgent: this.primaryAgent,
      target,
      text,
    });
  }

  protected deliverMedia(
    target: WecomTarget,
    params: WecomAgentSendMediaParams,
  ): Promise<AgentSendResult> {
    return deliverUpstreamAgentApiMedia({
      upstreamAgent: this.account,
      primaryAgent: this.primaryAgent,
      target,
      buffer: params.buffer,
      filename: params.filename,
      contentType: params.contentType,
      text: params.text,
    });
  }
}
