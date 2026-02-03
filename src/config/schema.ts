/**
 * WeCom 配置 Schema (Zod)
 */

import { z } from "zod";

/** DM 策略 Schema */
const dmSchema = z.object({
    enabled: z.boolean().optional(),
    policy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
}).optional();

/** 媒体配置 Schema */
const mediaSchema = z.object({
    tempDir: z.string().optional(),
    retentionHours: z.number().optional(),
    cleanupOnStart: z.boolean().optional(),
    maxBytes: z.number().optional(),
}).optional();

/** 网络配置 Schema */
const networkSchema = z.object({
    timeoutMs: z.number().optional(),
    retries: z.number().optional(),
    retryDelayMs: z.number().optional(),
}).optional();

/** Bot 模式配置 Schema */
const botSchema = z.object({
    token: z.string(),
    encodingAESKey: z.string(),
    receiveId: z.string().optional(),
    streamPlaceholderContent: z.string().optional(),
    welcomeText: z.string().optional(),
    dm: dmSchema,
}).optional();

/** Agent 模式配置 Schema */
const agentSchema = z.object({
    corpId: z.string(),
    corpSecret: z.string(),
    agentId: z.union([z.string(), z.number()]),
    token: z.string(),
    encodingAESKey: z.string(),
    welcomeText: z.string().optional(),
    dm: dmSchema,
}).optional();

/** 顶层 WeCom 配置 Schema */
export const WecomConfigSchema = z.object({
    enabled: z.boolean().optional(),
    bot: botSchema,
    agent: agentSchema,
    media: mediaSchema,
    network: networkSchema,
});

export type WecomConfigInput = z.infer<typeof WecomConfigSchema>;
