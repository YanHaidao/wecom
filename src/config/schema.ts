export interface DmConfig {
  policy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: (string | number)[];
}

export interface MediaConfig {
  tempDir?: string;
  retentionHours?: number;
  cleanupOnStart?: boolean;
  maxBytes?: number;
  downloadTimeoutMs?: number;
  localRoots?: string[];
}

export interface NetworkConfig {
  egressProxyUrl?: string;
  timeoutMs?: number;
  mediaDownloadTimeoutMs?: number;
}

export interface RoutingConfig {
  failClosedOnDefaultRoute?: boolean;
}

/**
 * 文本渲染格式，可配在渠道级或账号级（账号优先）。
 * 对齐 OpenClaw 的 markdown 配置模型，见 docs/concepts/markdown-formatting.md。
 */
export interface MarkdownConfig {
  /** `text`（默认）纯文本；`markdown` 按企微 markdown 发送。 */
  format?: "text" | "markdown";
}

export interface BotWsConfig {
  botId: string;
  secret: string;
}

export interface BotWebhookConfig {
  token: string;
  encodingAESKey: string;
  receiveId?: string;
}

export interface BotConfig {
  primaryTransport?: "ws" | "webhook";
  streamPlaceholderContent?: string;
  welcomeText?: string;
  dm?: DmConfig;
  aibotid?: string;
  botIds?: string[];
  ws?: BotWsConfig;
  webhook?: BotWebhookConfig;
}

export interface AgentConfig {
  corpId: string;
  agentSecret?: string;
  corpSecret?: string;
  agentId?: number | string;
  token: string;
  encodingAESKey: string;
  welcomeText?: string;
  dm?: DmConfig;
}

export interface DynamicAgentsConfig {
  enabled?: boolean;
  dmCreateAgent?: boolean;
  groupEnabled?: boolean;
  adminUsers?: string[];
}

export interface AccountConfig {
  enabled?: boolean;
  name?: string;
  mediaMaxMb?: number;
  markdown?: MarkdownConfig;
  bot?: BotConfig;
  agent?: AgentConfig;
}

export interface WecomConfigInput {
  enabled?: boolean;
  mediaMaxMb?: number;
  mediaDownloadTimeoutMs?: number;
  markdown?: MarkdownConfig;
  bot?: BotConfig;
  agent?: AgentConfig;
  accounts?: Record<string, AccountConfig>;
  defaultAccount?: string;
  media?: MediaConfig;
  network?: NetworkConfig;
  routing?: RoutingConfig;
  dynamicAgents?: DynamicAgentsConfig;
}

/**
 * @deprecated No longer a Zod schema. Kept as a type-only export for backward compatibility.
 */
export const WecomConfigSchema = undefined;
