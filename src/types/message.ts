/**
 * WeCom 消息类型定义
 * Bot 和 Agent 模式共用
 */

/**
 * Bot 模式入站消息基础结构 (JSON)
 */
export type WecomBotInboundBase = {
    msgid?: string;
    aibotid?: string;
    chattype?: "single" | "group";
    chatid?: string;
    response_url?: string;
    from?: { userid?: string; corpid?: string };
    msgtype?: string;
};

export type WecomBotInboundText = WecomBotInboundBase & {
    msgtype: "text";
    text?: { content?: string };
    quote?: WecomInboundQuote;
};

export type WecomBotInboundVoice = WecomBotInboundBase & {
    msgtype: "voice";
    voice?: { content?: string };
    quote?: WecomInboundQuote;
};

export type WecomBotInboundStreamRefresh = WecomBotInboundBase & {
    msgtype: "stream";
    stream?: { id?: string };
};

export type WecomBotInboundEvent = WecomBotInboundBase & {
    msgtype: "event";
    create_time?: number;
    event?: {
        eventtype?: string;
        [key: string]: unknown;
    };
};

export type WecomInboundQuote = {
    msgtype?: "text" | "image" | "mixed" | "voice" | "file";
    text?: { content?: string };
    image?: { url?: string };
    mixed?: {
        msg_item?: Array<{
            msgtype: "text" | "image";
            text?: { content?: string };
            image?: { url?: string };
        }>;
    };
    voice?: { content?: string };
    file?: { url?: string };
};

export type WecomBotInboundMessage =
    | WecomBotInboundText
    | WecomBotInboundVoice
    | WecomBotInboundStreamRefresh
    | WecomBotInboundEvent
    | (WecomBotInboundBase & { quote?: WecomInboundQuote } & Record<string, unknown>);

/**
 * Agent 模式入站消息结构 (解析自 XML)
 */
export type WecomAgentInboundMessage = {
    ToUserName?: string;
    FromUserName?: string;
    CreateTime?: number;
    MsgType?: string;
    MsgId?: string;
    AgentID?: number;
    // 文本消息
    Content?: string;
    // 图片消息
    PicUrl?: string;
    MediaId?: string;
    // 语音消息
    Format?: string;
    Recognition?: string;
    // 视频消息
    ThumbMediaId?: string;
    // 位置消息
    Location_X?: number;
    Location_Y?: number;
    Scale?: number;
    Label?: string;
    // 链接消息
    Title?: string;
    Description?: string;
    Url?: string;
    // 事件消息
    Event?: string;
    EventKey?: string;
    // 群聊
    ChatId?: string;
};

/**
 * 模板卡片类型
 */
export type WecomTemplateCard = {
    card_type: "text_notice" | "news_notice" | "button_interaction" | "vote_interaction" | "multiple_interaction";
    source?: { icon_url?: string; desc?: string; desc_color?: number };
    main_title?: { title?: string; desc?: string };
    task_id?: string;
    button_list?: Array<{ text: string; style?: number; key: string }>;
    sub_title_text?: string;
    horizontal_content_list?: Array<{
        keyname: string;
        value?: string;
        type?: number;
        url?: string;
        userid?: string;
    }>;
    card_action?: { type: number; url?: string; appid?: string; pagepath?: string };
    action_menu?: { desc: string; action_list: Array<{ text: string; key: string }> };
    select_list?: Array<{
        question_key: string;
        title?: string;
        selected_id?: string;
        option_list: Array<{ id: string; text: string }>;
    }>;
    submit_button?: { text: string; key: string };
    checkbox?: {
        question_key: string;
        option_list: Array<{ id: string; text: string; is_checked?: boolean }>;
        mode?: number;
    };
};

/**
 * 出站消息类型
 */
export type WecomOutboundMessage =
    | { msgtype: "text"; text: { content: string } }
    | { msgtype: "markdown"; markdown: { content: string } }
    | { msgtype: "template_card"; template_card: WecomTemplateCard };
