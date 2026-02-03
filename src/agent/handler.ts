/**
 * WeCom Agent Webhook 处理器
 * 处理 XML 格式回调
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import type { ResolvedAgentAccount } from "../types/index.js";
import { LIMITS } from "../types/constants.js";
import { decryptWecomEncrypted, verifyWecomSignature, computeWecomMsgSignature, encryptWecomPlaintext } from "../crypto/index.js";
import { extractEncryptFromXml, buildEncryptedXmlResponse } from "../crypto/xml.js";
import { parseXml, extractMsgType, extractFromUser, extractContent, extractChatId } from "../shared/xml-parser.js";
import { sendText } from "./api-client.js";
import { getWecomRuntime } from "../runtime.js";

/** 错误提示信息 */
const ERROR_HELP = "\n\n遇到问题？联系作者: YanHaidao (微信: YanHaidao)";

export type AgentWebhookParams = {
    req: IncomingMessage;
    res: ServerResponse;
    agent: ResolvedAgentAccount;
    config: OpenClawConfig;
    core: PluginRuntime;
    log?: (msg: string) => void;
    error?: (msg: string) => void;
};

/**
 * 解析查询参数
 */
function resolveQueryParams(req: IncomingMessage): URLSearchParams {
    const url = new URL(req.url ?? "/", "http://localhost");
    return url.searchParams;
}

/**
 * 读取原始请求体
 */
async function readRawBody(req: IncomingMessage, maxSize: number = LIMITS.MAX_REQUEST_BODY_SIZE): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;

        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxSize) {
                reject(new Error("Request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on("end", () => {
            resolve(Buffer.concat(chunks).toString("utf8"));
        });

        req.on("error", reject);
    });
}

/**
 * 处理 URL 验证 (GET)
 */
async function handleUrlVerification(
    req: IncomingMessage,
    res: ServerResponse,
    agent: ResolvedAgentAccount,
): Promise<boolean> {
    const query = resolveQueryParams(req);
    const timestamp = query.get("timestamp") ?? "";
    const nonce = query.get("nonce") ?? "";
    const echostr = query.get("echostr") ?? "";
    const signature = query.get("msg_signature") ?? "";

    const valid = verifyWecomSignature({
        token: agent.token,
        timestamp,
        nonce,
        encrypt: echostr,
        signature,
    });

    if (!valid) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(`unauthorized - 签名验证失败，请检查 Token 配置${ERROR_HELP}`);
        return true;
    }

    try {
        const plain = decryptWecomEncrypted({
            encodingAESKey: agent.encodingAESKey,
            receiveId: agent.corpId,
            encrypt: echostr,
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(plain);
        return true;
    } catch {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(`decrypt failed - 解密失败，请检查 EncodingAESKey 配置${ERROR_HELP}`);
        return true;
    }
}

/**
 * 处理消息回调 (POST)
 */
async function handleMessageCallback(params: AgentWebhookParams): Promise<boolean> {
    const { req, res, agent, config, core, log, error } = params;

    try {
        const rawXml = await readRawBody(req);
        const encrypted = extractEncryptFromXml(rawXml);

        const query = resolveQueryParams(req);
        const timestamp = query.get("timestamp") ?? "";
        const nonce = query.get("nonce") ?? "";
        const signature = query.get("msg_signature") ?? "";

        // 验证签名
        const valid = verifyWecomSignature({
            token: agent.token,
            timestamp,
            nonce,
            encrypt: encrypted,
            signature,
        });

        if (!valid) {
            res.statusCode = 401;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(`unauthorized - 签名验证失败${ERROR_HELP}`);
            return true;
        }

        // 解密
        const decrypted = decryptWecomEncrypted({
            encodingAESKey: agent.encodingAESKey,
            receiveId: agent.corpId,
            encrypt: encrypted,
        });

        // 解析 XML
        const msg = parseXml(decrypted);
        const msgType = extractMsgType(msg);
        const fromUser = extractFromUser(msg);
        const chatId = extractChatId(msg);
        const content = extractContent(msg);

        log?.(`[wecom-agent] ${msgType} from=${fromUser} chatId=${chatId ?? "N/A"} content=${content.slice(0, 100)}`);

        // 先返回 success (Agent 模式使用 API 发送回复，不用被动回复)
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("success");

        // 异步处理消息
        processAgentMessage({
            agent,
            config,
            core,
            fromUser,
            chatId,
            msgType,
            content,
            log,
            error,
        }).catch((err) => {
            error?.(`[wecom-agent] process failed: ${String(err)}`);
        });

        return true;
    } catch (err) {
        error?.(`[wecom-agent] callback failed: ${String(err)}`);
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(`error - 回调处理失败${ERROR_HELP}`);
        return true;
    }
}

/**
 * 处理 Agent 消息 (调用 OpenClaw Agent)
 */
async function processAgentMessage(params: {
    agent: ResolvedAgentAccount;
    config: OpenClawConfig;
    core: PluginRuntime;
    fromUser: string;
    chatId?: string;
    msgType: string;
    content: string;
    log?: (msg: string) => void;
    error?: (msg: string) => void;
}): Promise<void> {
    const { agent, config, core, fromUser, chatId, content, log, error } = params;

    const isGroup = Boolean(chatId);
    const peerId = isGroup ? chatId! : fromUser;

    // 解析路由
    const route = core.channel.routing.resolveAgentRoute({
        cfg: config,
        channel: "wecom",
        accountId: agent.accountId,
        peer: { kind: isGroup ? "group" : "dm", id: peerId },
    });

    // 构建上下文
    const fromLabel = isGroup ? `group:${peerId}` : `user:${fromUser}`;
    const storePath = core.channel.session.resolveStorePath(config.session?.store, {
        agentId: route.agentId,
    });
    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
    const previousTimestamp = core.channel.session.readSessionUpdatedAt({
        storePath,
        sessionKey: route.sessionKey,
    });
    const body = core.channel.reply.formatAgentEnvelope({
        channel: "WeCom",
        from: fromLabel,
        previousTimestamp,
        envelope: envelopeOptions,
        body: content,
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
        Body: body,
        RawBody: content,
        CommandBody: content,
        From: isGroup ? `wecom:group:${peerId}` : `wecom:${fromUser}`,
        To: `wecom:${peerId}`,
        SessionKey: route.sessionKey,
        AccountId: route.accountId,
        ChatType: isGroup ? "group" : "direct",
        ConversationLabel: fromLabel,
        SenderName: fromUser,
        SenderId: fromUser,
        Provider: "wecom",
        Surface: "wecom",
        OriginatingChannel: "wecom",
        OriginatingTo: `wecom:${peerId}`,
        CommandAuthorized: true, // 已通过 WeCom 签名验证
    });

    // 记录会话
    await core.channel.session.recordInboundSession({
        storePath,
        sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
        ctx: ctxPayload,
        onRecordError: (err: unknown) => {
            error?.(`[wecom-agent] session record failed: ${String(err)}`);
        },
    });

    // 调度回复
    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg: config,
        dispatcherOptions: {
            deliver: async (payload: { text?: string }, info: { kind: string }) => {
                const text = payload.text ?? "";
                if (!text) return;

                try {
                    await sendText({
                        agent,
                        toUser: fromUser,
                        chatId: isGroup ? chatId : undefined,
                        text,
                    });
                    log?.(`[wecom-agent] reply delivered (${info.kind}) to ${fromUser}`);
                } catch (err: unknown) {
                    error?.(`[wecom-agent] reply failed: ${String(err)}`);
                }
            },
            onError: (err: unknown, info: { kind: string }) => {
                error?.(`[wecom-agent] ${info.kind} reply error: ${String(err)}`);
            },
        },
        replyOptions: {
            disableBlockStreaming: true,
        },
    });
}

/**
 * 处理 Agent Webhook 请求入口
 */
export async function handleAgentWebhook(params: AgentWebhookParams): Promise<boolean> {
    const { req } = params;

    if (req.method === "GET") {
        return handleUrlVerification(req, params.res, params.agent);
    }

    if (req.method === "POST") {
        return handleMessageCallback(params);
    }

    return false;
}
