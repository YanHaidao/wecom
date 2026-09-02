/**
 * 模板卡片管理器
 *
 * 负责：
 * - 模板卡片缓存管理（内存级，带 TTL 和大小限制）
 * - 卡片交互事件处理（更新卡片 UI 状态）
 * - 模板卡片发送（通过 wsClient.sendMessage 主动推送）
 * - 从 LLM 回复中检测并处理模板卡片
 */

import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import type { WSClient, WsFrame, TemplateCard } from "@wecom/aibot-node-sdk";
import type { MessageBody } from "./message-parser.js";
import type { ResolvedWeComAccount } from "./utils.js";
import type { MessageState, ExtractedTemplateCard } from "./interface.js";
import { extractTemplateCards } from "./template-card-parser.js";
import {
  TEMPLATE_CARD_CACHE_TTL_MS,
  TEMPLATE_CARD_CACHE_MAX_SIZE,
} from "./const.js";
import {
  diagnosticFingerprint,
  formatDiagnosticError,
  utf8Bytes,
  wecomFlowId,
} from "./diagnostics.js";

// ============================================================================
// 模板卡片缓存
// ============================================================================

interface SentTemplateCardCacheEntry {
  templateCard: TemplateCard;
  createdAt: number;
}

const sentTemplateCardByTaskId = new Map<string, SentTemplateCardCacheEntry>();

function getTemplateCardCacheKey(accountId: string, taskId: string): string {
  return `${accountId}:${taskId}`;
}

function pruneTemplateCardCache(): void {
  const now = Date.now();

  for (const [key, entry] of sentTemplateCardByTaskId) {
    if (now - entry.createdAt >= TEMPLATE_CARD_CACHE_TTL_MS) {
      sentTemplateCardByTaskId.delete(key);
    }
  }

  if (sentTemplateCardByTaskId.size <= TEMPLATE_CARD_CACHE_MAX_SIZE) {
    return;
  }

  const sortedEntries = [...sentTemplateCardByTaskId.entries()].sort(
    (a, b) => a[1].createdAt - b[1].createdAt,
  );
  const removeCount = sentTemplateCardByTaskId.size - TEMPLATE_CARD_CACHE_MAX_SIZE;
  for (const [key] of sortedEntries.slice(0, removeCount)) {
    sentTemplateCardByTaskId.delete(key);
  }
}

function cloneTemplateCard(card: TemplateCard): TemplateCard {
  return JSON.parse(JSON.stringify(card)) as TemplateCard;
}

export function saveTemplateCardToCache(params: {
  accountId: string;
  templateCard: TemplateCard;
  runtime: RuntimeEnv;
}): void {
  const { accountId, templateCard, runtime } = params;
  const taskId = templateCard.task_id;
  if (!taskId) {
    runtime.log?.("[wecom][template-card] Skip cache: template card has no task_id");
    return;
  }

  sentTemplateCardByTaskId.set(getTemplateCardCacheKey(accountId, taskId), {
    templateCard: cloneTemplateCard(templateCard),
    createdAt: Date.now(),
  });
  pruneTemplateCardCache();
}

export function getTemplateCardFromCache(accountId: string, taskId: string): TemplateCard | undefined {
  pruneTemplateCardCache();
  const cached = sentTemplateCardByTaskId.get(getTemplateCardCacheKey(accountId, taskId));
  if (!cached) {
    return undefined;
  }
  return cloneTemplateCard(cached.templateCard);
}

// ============================================================================
// 模板卡片事件更新
// ============================================================================

type TemplateCardEventPayload = NonNullable<NonNullable<MessageBody["event"]>["template_card_event"]>;

function buildSelectedOptionMap(templateCardEvent?: TemplateCardEventPayload): Map<string, string[]> {
  const selectedMap = new Map<string, string[]>();
  const selectedItems = templateCardEvent?.selected_items?.selected_item ?? [];

  for (const item of selectedItems) {
    const questionKey = item.question_key?.trim();
    if (!questionKey) {
      continue;
    }
    const optionIds = item.option_ids?.option_id?.filter(Boolean) ?? [];
    selectedMap.set(questionKey, optionIds);
  }

  return selectedMap;
}

function applySelectedStateToTemplateCard(params: {
  templateCard: TemplateCard;
  selectedMap: Map<string, string[]>;
  templateCardEvent?: TemplateCardEventPayload;
}): TemplateCard {
  const { templateCard, selectedMap, templateCardEvent } = params;
  const nextCard = cloneTemplateCard(templateCard);

  if (templateCardEvent?.task_id) {
    nextCard.task_id = templateCardEvent.task_id;
  }
  if (templateCardEvent?.card_type) {
    nextCard.card_type = templateCardEvent.card_type;
  }

  if (nextCard.submit_button?.text) {
    nextCard.submit_button.text = "已提交";
  }

  if (nextCard.checkbox?.question_key) {
    const selectedIds = selectedMap.get(nextCard.checkbox.question_key) ?? [];
    nextCard.checkbox.disable = true;
    if (Array.isArray(nextCard.checkbox.option_list)) {
      nextCard.checkbox.option_list = nextCard.checkbox.option_list.map((option) => ({
        ...option,
        is_checked: selectedIds.includes(option.id),
      }));
    }
  }

  if (Array.isArray(nextCard.select_list)) {
    nextCard.select_list = nextCard.select_list.map((selection) => {
      const selectedIds = selectedMap.get(selection.question_key) ?? [];
      return {
        ...selection,
        disable: true,
        selected_id: selectedIds[0] ?? selection.selected_id,
      };
    });
  }

  if (nextCard.button_selection?.question_key) {
    const selectedIds = selectedMap.get(nextCard.button_selection.question_key) ?? [];
    nextCard.button_selection.disable = true;
    if (selectedIds[0]) {
      nextCard.button_selection.selected_id = selectedIds[0];
    }
  }

  return nextCard;
}

export async function updateTemplateCardOnEvent(params: {
  frame: WsFrame;
  accountId: string;
  runtime: RuntimeEnv;
  wsClient: WSClient;
}): Promise<void> {
  const { frame, accountId, runtime, wsClient } = params;
  const body = frame.body as MessageBody;
  const templateCardEvent = body.event?.template_card_event;
  const taskId = templateCardEvent?.task_id;
  const traceId = wecomFlowId({
    accountId,
    reqId: frame.headers.req_id,
    messageId: body.msgid,
  });

  if (!taskId) {
    runtime.log?.(
      `[wecom][template-card] trace=${traceId} account=${accountId} stage=update_skipped reason=missing_task_id`,
    );
    return;
  }

  const cachedCard = getTemplateCardFromCache(accountId, taskId);
  if (!cachedCard) {
    runtime.log?.(
      `[wecom][template-card] trace=${traceId} account=${accountId} stage=update_skipped reason=cache_miss task=${diagnosticFingerprint(taskId)} cache=memory`,
    );
    return;
  }

  const selectedMap = buildSelectedOptionMap(templateCardEvent);
  const updatedCard = applySelectedStateToTemplateCard({
    templateCard: cachedCard,
    selectedMap,
    templateCardEvent,
  });

  const startedAt = Date.now();
  await wsClient.updateTemplateCard(frame, updatedCard, [body.from.userid]);
  runtime.log?.(
    `[wecom][template-card] trace=${traceId} account=${accountId} stage=updated task=${diagnosticFingerprint(taskId)} selections=${selectedMap.size} durationMs=${Date.now() - startedAt}`,
  );

  saveTemplateCardToCache({
    accountId,
    templateCard: updatedCard,
    runtime,
  });
}

// ============================================================================
// 模板卡片发送
// ============================================================================

/**
 * 逐个发送已提取的模板卡片（通过 wsClient.sendMessage 主动推送）
 *
 * 发送失败不阻塞流程，仅记录错误日志。
 */
export async function sendTemplateCards(params: {
  wsClient: WSClient;
  frame: WsFrame;
  state: MessageState;
  account: ResolvedWeComAccount;
  runtime: RuntimeEnv;
  cards: ExtractedTemplateCard[];
}): Promise<void> {
  const { wsClient, frame, state, runtime, account, cards } = params;
  const body = frame.body as MessageBody;
  const chatId = body.chatid || body.from.userid;
  const traceId = state.traceId ?? wecomFlowId({
    accountId: account.accountId,
    reqId: frame.headers.req_id,
    messageId: body.msgid,
  });

  for (const card of cards) {
    const startedAt = Date.now();
    try {
      runtime.log?.(
        `[wecom][template-card] trace=${traceId} account=${account.accountId} stage=send_start cardType=${card.cardType} chat=${diagnosticFingerprint(chatId)}`,
      );

      const rawTemplateCard = card.cardJson as Record<string, unknown>;
      if (typeof rawTemplateCard.card_type !== "string") {
        runtime.error?.(
          `[wecom][template-card] trace=${traceId} account=${account.accountId} stage=send_skipped reason=missing_card_type`,
        );
        continue;
      }

      const templateCard = rawTemplateCard as unknown as TemplateCard;
      await wsClient.sendMessage(chatId, {
        msgtype: "template_card",
        template_card: templateCard,
      });
      state.hasTemplateCard = true;
      saveTemplateCardToCache({
        accountId: account.accountId,
        templateCard,
        runtime,
      });
      runtime.log?.(
        `[wecom][template-card] trace=${traceId} account=${account.accountId} stage=send_delivered cardType=${card.cardType} task=${diagnosticFingerprint(templateCard.task_id)} durationMs=${Date.now() - startedAt}`,
      );
    } catch (err) {
      runtime.error?.(
        `[wecom][template-card] trace=${traceId} account=${account.accountId} stage=send_failed cardType=${card.cardType} durationMs=${Date.now() - startedAt} ${formatDiagnosticError(err)}`,
      );
    }
  }
}

// ============================================================================
// 模板卡片检测与处理（从 finishThinkingStream 中分离）
// ============================================================================

/**
 * 从累积文本中检测并发送模板卡片。
 *
 * 在 finishThinkingStream 之前调用，将卡片处理和流关闭解耦。
 *
 * @returns 移除卡片代码块后的剩余文本（如果没有卡片则返回 null，表示无需修改）
 */
export async function processTemplateCardsIfNeeded(params: {
  wsClient: WSClient;
  frame: WsFrame;
  state: MessageState;
  account: ResolvedWeComAccount;
  runtime: RuntimeEnv;
}): Promise<{ remainingText: string; cardsDetected: boolean } | null> {
  const { state, runtime, account } = params;
  const traceId = state.traceId ?? "none";
  const visibleText = state.accumulatedText?.trim();

  if (!visibleText) {
    runtime.log?.(
      `[wecom][template-card] trace=${traceId} account=${account.accountId} stage=extract_skipped reason=empty_text`,
    );
    return null;
  }

  const startedAt = Date.now();
  runtime.log?.(
    `[wecom][template-card] trace=${traceId} account=${account.accountId} stage=extract_start textBytes=${utf8Bytes(visibleText)}`,
  );
  const logFn = (...args: any[]): void => {
    runtime.log?.(...args);
  };
  const { cards, remainingText } = extractTemplateCards(state.accumulatedText, logFn);

  runtime.log?.(
    `[wecom][template-card] trace=${traceId} account=${account.accountId} stage=extract_complete cards=${cards.length} remainingBytes=${utf8Bytes(remainingText)} durationMs=${Date.now() - startedAt}`,
  );

  if (cards.length === 0) {
    return null;
  }

  runtime.log?.(
    `[wecom][template-card] trace=${traceId} account=${account.accountId} stage=cards_detected count=${cards.length} cardTypes=${cards.map((card) => card.cardType).join(",")}`,
  );
  await sendTemplateCards({ ...params, cards });

  return { remainingText, cardsDetected: true };
}
