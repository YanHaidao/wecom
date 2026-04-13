export interface DmConfig {
  policy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: (string | number)[];
}

export interface AgentEventPolicyConfig {
  allowedEventTypes?: string[];
}

export interface AgentInboundPolicyConfig {
  eventEnabled?: boolean;
  eventPolicy?: AgentEventPolicyConfig;
}

export interface AgentEventRouteMatchConfig {
  eventType?: string;
  changeType?: string;
  eventKey?: string;
  eventKeyPrefix?: string;
  eventKeyPattern?: string;
}

export interface AgentEventRouteHandlerBuiltinConfig {
  type: "builtin";
  name?: "echo";
  chainToAgent?: boolean;
}

export interface AgentEventRouteHandlerScriptConfig {
  type: "node_script" | "python_script";
  entry: string;
  timeoutMs?: number;
  chainToAgent?: boolean;
}

export type AgentEventRouteHandlerConfig =
  | AgentEventRouteHandlerBuiltinConfig
  | AgentEventRouteHandlerScriptConfig;

export interface AgentEventRouteConfig {
  id?: string;
  when?: AgentEventRouteMatchConfig;
  handler: AgentEventRouteHandlerConfig;
}

export interface AgentEventRoutingConfig {
  unmatchedAction?: "ignore" | "forwardToAgent";
  routes?: AgentEventRouteConfig[];
}

export interface AgentScriptRuntimeConfig {
  enabled?: boolean;
  allowPaths?: string[];
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  defaultTimeoutMs?: number;
  pythonCommand?: string;
  nodeCommand?: string;
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
  inboundPolicy?: AgentInboundPolicyConfig;
  eventRouting?: AgentEventRoutingConfig;
  scriptRuntime?: AgentScriptRuntimeConfig;
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
  bot?: BotConfig;
  agent?: AgentConfig;
}

export interface WecomConfigInput {
  enabled?: boolean;
  mediaMaxMb?: number;
  mediaDownloadTimeoutMs?: number;
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
