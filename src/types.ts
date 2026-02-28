/**
 * Backward-compatible type bridge.
 * Canonical definitions live in `src/types/*`.
 */
export type {
  WecomDmConfig,
  WecomAccountConfig,
  WecomConfig,
  ResolvedWecomAccount,
  WecomInboundQuote,
  WecomTemplateCard,
  WecomOutboundMessage,
} from "./types/index.js";

import type {
  WecomBotInboundBase,
  WecomBotInboundText,
  WecomBotInboundVoice,
  WecomBotInboundStreamRefresh,
  WecomBotInboundEvent,
  WecomBotInboundMessage,
} from "./types/index.js";

export type WecomInboundBase = WecomBotInboundBase;
export type WecomInboundText = WecomBotInboundText;
export type WecomInboundVoice = WecomBotInboundVoice;
export type WecomInboundStreamRefresh = WecomBotInboundStreamRefresh;
export type WecomInboundEvent = WecomBotInboundEvent;
export type WecomInboundMessage = WecomBotInboundMessage;

export type WecomInboundTemplateCardEvent = WecomBotInboundEvent;
export type WecomTemplateCardEventPayload = {
  card_type: string;
  event_key: string;
  task_id: string;
  response_code?: string;
  selected_items?: {
    question_key?: string;
    option_ids?: string[];
  };
};
