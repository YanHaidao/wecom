/**
 * WeCom XML 解析器
 * 用于 Agent 模式解析 XML 格式消息
 */

import { XMLParser } from "fast-xml-parser";
import type { WecomAgentInboundMessage } from "../types/index.js";

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    processEntities: false,
});

/**
 * 解析 XML 字符串为消息对象
 */
export function parseXml(xml: string): WecomAgentInboundMessage {
    const obj = xmlParser.parse(xml);
    const root = obj?.xml ?? obj;
    return root ?? {};
}

/**
 * 从 XML 中提取消息类型
 */
export function extractMsgType(msg: WecomAgentInboundMessage): string {
    return String(msg.MsgType ?? "").toLowerCase();
}

/**
 * 从 XML 中提取发送者 ID
 */
export function extractFromUser(msg: WecomAgentInboundMessage): string {
    return String(msg.FromUserName ?? "");
}

/**
 * 从 XML 中提取接收者 ID (CorpID)
 */
export function extractToUser(msg: WecomAgentInboundMessage): string {
    return String(msg.ToUserName ?? "");
}

/**
 * 从 XML 中提取群聊 ID
 */
export function extractChatId(msg: WecomAgentInboundMessage): string | undefined {
    return msg.ChatId ? String(msg.ChatId) : undefined;
}

/**
 * 从 XML 中提取消息内容
 */
export function extractContent(msg: WecomAgentInboundMessage): string {
    const msgType = extractMsgType(msg);

    switch (msgType) {
        case "text":
            return msg.Content ?? "";
        case "voice":
            // 语音识别结果
            return msg.Recognition ?? "[语音消息]";
        case "image":
            return `[图片] ${msg.PicUrl ?? ""}`;
        case "video":
            return "[视频消息]";
        case "location":
            return `[位置] ${msg.Label ?? ""} (${msg.Location_X}, ${msg.Location_Y})`;
        case "link":
            return `[链接] ${msg.Title ?? ""}\n${msg.Description ?? ""}\n${msg.Url ?? ""}`;
        case "event":
            return `[事件] ${msg.Event ?? ""} - ${msg.EventKey ?? ""}`;
        default:
            return `[${msgType || "未知消息类型"}]`;
    }
}
