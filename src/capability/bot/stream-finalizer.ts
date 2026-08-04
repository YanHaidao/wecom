import type { PluginRuntime } from "openclaw/plugin-sdk";

import { getActiveReplyUrl } from "../../transport/bot-webhook/active-reply.js";
import { type StreamStore } from "../../monitor/state.js";
import type { WecomWebhookTarget } from "../../types/runtime-context.js";
import { pushFinalStreamReplyNow, resolveAgentAccountOrUndefined, sendAgentDmText } from "./fallback-delivery.js";
import type { BotRuntimeLogger, RecordBotOperationalEvent } from "./types.js";

export async function finalizeBotStream(params: {
  streamStore: StreamStore;
  target: WecomWebhookTarget;
  streamId: string;
  chatType: "group" | "direct";
  core: PluginRuntime;
  config: WecomWebhookTarget["config"];
  accountId: string;
  isResetCommand: boolean;
  resetCommandKind: string | null;
  logInfo: BotRuntimeLogger;
  logVerbose: BotRuntimeLogger;
  recordBotOperationalEvent: RecordBotOperationalEvent;
}): Promise<void> {
  const {
    streamStore,
    target,
    streamId,
    chatType,
    core,
    config,
    accountId,
    isResetCommand,
    resetCommandKind,
    logInfo,
    logVerbose,
    recordBotOperationalEvent,
  } = params;

  if (isResetCommand) {
    const current = streamStore.getStream(streamId);
    const hasAnyContent = Boolean(current?.content?.trim());
    if (current && !hasAnyContent) {
      const ackText = resetCommandKind === "reset" ? "✅ 已重置会话。" : "✅ 已开启新会话。";
      streamStore.updateStream(streamId, (s) => {
        s.content = ackText;
        s.finished = true;
      });
    }
  }

  streamStore.updateStream(streamId, (s) => {
    if (!s.content.trim() && !(s.images?.length ?? 0)) {
      s.content = "✅ 已处理完成。";
    }
  });

  streamStore.markFinished(streamId);

  const finishedState = streamStore.getStream(streamId);
  if (finishedState?.fallbackMode === "timeout" && !finishedState.finalDeliveredAt) {
    const agentCfg = resolveAgentAccountOrUndefined(config, accountId);
    if (!agentCfg) {
      streamStore.updateStream(streamId, (s) => {
        s.finalDeliveredAt = Date.now();
      });
    } else if (finishedState.userId) {
      const dmText = (finishedState.dmContent ?? "").trim();
      if (dmText) {
        try {
          logVerbose(target, `fallback(timeout): 开始通过 Agent 私信发送剩余内容 user=${finishedState.userId} len=${dmText.length}`);
          await sendAgentDmText({
            agent: agentCfg,
            userId: finishedState.userId,
            text: dmText,
            core,
            cfg: config,
          });
          logVerbose(target, `fallback(timeout): Agent 私信发送完成 user=${finishedState.userId}`);
        } catch (err) {
          target.runtime.error?.(`wecom agent dm text failed (timeout): ${String(err)}`);
          recordBotOperationalEvent(target, {
            category: "fallback-delivery-failed",
            summary: `timeout final dm failed streamId=${streamId} user=${finishedState.userId}`,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      streamStore.updateStream(streamId, (s) => {
        s.finalDeliveredAt = Date.now();
      });
    }
  }

  const stateAfterFinish = streamStore.getStream(streamId);
  const responseUrl = getActiveReplyUrl(streamId);
  if (stateAfterFinish && responseUrl) {
    try {
      await pushFinalStreamReplyNow({ streamId, state: stateAfterFinish });
      logVerbose(
        target,
        `final stream pushed via response_url streamId=${streamId}, chatType=${chatType}, images=${stateAfterFinish.images?.length ?? 0}`,
      );
    } catch (err) {
      target.runtime.error?.(`final stream push via response_url failed streamId=${streamId}: ${String(err)}`);
      recordBotOperationalEvent(target, {
        category: "fallback-delivery-failed",
        summary: `final stream push failed streamId=${streamId}`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logInfo(target, `queue: 当前批次结束，尝试推进下一批 streamId=${streamId}`);
  const ackStreamIds = streamStore.drainAckStreamsForBatch(streamId);
  if (ackStreamIds.length > 0) {
    const mergedDoneHint = "✅ 已合并处理完成，请查看上一条回复。";
    for (const ackId of ackStreamIds) {
      streamStore.updateStream(ackId, (s) => {
        s.content = mergedDoneHint;
        s.finished = true;
      });
    }
    logInfo(target, `queue: 已更新回执流 count=${ackStreamIds.length} batchStreamId=${streamId}`);
  }

  streamStore.onStreamFinished(streamId);
}
