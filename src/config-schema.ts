import { buildJsonChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";

const allowFromSchema = {
  type: "array",
  items: { anyOf: [{ type: "string" }, { type: "number" }] },
} as const;

const dmPolicySchema = {
  type: "string",
  enum: ["open", "pairing", "allowlist", "disabled"],
} as const;

const groupPolicySchema = {
  type: "string",
  enum: ["open", "allowlist", "disabled"],
} as const;

const groupSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    allowFrom: allowFromSchema,
  },
} as const;

const agentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    corpId: { type: "string" },
    corpSecret: { type: "string" },
    agentId: { anyOf: [{ type: "string" }, { type: "number" }] },
    token: { type: "string" },
    encodingAESKey: { type: "string" },
    welcomeText: { type: "string" },
    dmPolicy: dmPolicySchema,
    allowFrom: allowFromSchema,
    upstreamCorps: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["corpId", "agentId"],
        properties: {
          corpId: { type: "string" },
          agentId: { anyOf: [{ type: "string" }, { type: "number" }] },
        },
      },
    },
  },
} as const;

const networkSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    timeoutMs: { type: "number", minimum: 0 },
    retries: { type: "number", minimum: 0 },
    retryDelayMs: { type: "number", minimum: 0 },
    egressProxyUrl: { type: "string" },
  },
} as const;

const mediaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tempDir: { type: "string" },
    retentionHours: { type: "number", minimum: 0 },
    cleanupOnStart: { type: "boolean" },
    maxBytes: { type: "number", minimum: 0 },
  },
} as const;

const dynamicAgentsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    dmCreateAgent: { type: "boolean" },
    groupEnabled: { type: "boolean" },
    adminUsers: { type: "array", items: { type: "string" } },
  },
} as const;

const cliSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    binPath: { type: "string" },
    env: {
      type: "object",
      additionalProperties: false,
      properties: {
        WECOM_CLI_BASE_URL: { type: "string" },
        WECOM_CLI_AUTH_ENDPOINT: { type: "string" },
        WECOM_CLI_ADDITIONAL_HEADERS: { type: "string" },
      },
    },
  },
} as const;

const accountProperties = {
  enabled: { type: "boolean" },
  name: { type: "string" },
  connectionMode: { type: "string", enum: ["websocket", "webhook"] },
  websocketUrl: { type: "string" },
  botId: { type: "string" },
  secret: { type: "string" },
  token: { type: "string" },
  encodingAESKey: { type: "string" },
  receiveId: { type: "string" },
  dmPolicy: dmPolicySchema,
  allowFrom: allowFromSchema,
  groupPolicy: groupPolicySchema,
  groupAllowFrom: allowFromSchema,
  groups: { type: "object", additionalProperties: groupSchema },
  agent: agentSchema,
  network: networkSchema,
  media: mediaSchema,
  dynamicAgents: dynamicAgentsSchema,
  cli: cliSchema,
  sendThinkingMessage: { type: "boolean" },
  mediaLocalRoots: { type: "array", items: { type: "string" } },
  welcomeText: { type: "string" },
  streamPlaceholderContent: { type: "string" },
} as const;

export const wecomAccountJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: accountProperties,
} as const;

export const wecomChannelJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...accountProperties,
    defaultAccount: { type: "string" },
    accounts: {
      type: "object",
      additionalProperties: wecomAccountJsonSchema,
    },
  },
} as const;

export const wecomChannelConfigSchema: NonNullable<ChannelPlugin["configSchema"]> =
  buildJsonChannelConfigSchema(
    wecomChannelJsonSchema,
    {
      cacheKey: "yanhaidao-wecom:channel-config",
      uiHints: {
        botId: { label: "Bot ID" },
        secret: { label: "Bot Secret", sensitive: true },
        token: { label: "Webhook Token", sensitive: true },
        encodingAESKey: { label: "Webhook EncodingAESKey", sensitive: true },
      },
    },
  );
