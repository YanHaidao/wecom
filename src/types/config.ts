export type WecomDmPolicy = "open" | "pairing" | "allowlist" | "disabled";
export type WecomBotPrimaryTransport = "ws" | "webhook";

export type WecomDmConfig = {
  policy?: WecomDmPolicy;
  allowFrom?: Array<string | number>;
};

export type WecomMediaConfig = {
  tempDir?: string;
  retentionHours?: number;
  cleanupOnStart?: boolean;
  maxBytes?: number;
  downloadTimeoutMs?: number;
  localRoots?: string[];
};

export type WecomNetworkConfig = {
  egressProxyUrl?: string;
  timeoutMs?: number;
  mediaDownloadTimeoutMs?: number;
};

export type WecomRoutingConfig = {
  failClosedOnDefaultRoute?: boolean;
};

export type WecomBotWsConfig = {
  botId: string;
  secret: string;
};

export type WecomBotWebhookConfig = {
  token: string;
  encodingAESKey: string;
  receiveId?: string;
};

export type WecomBotConfig = {
  primaryTransport?: WecomBotPrimaryTransport;
  streamPlaceholderContent?: string;
  welcomeText?: string;
  dm?: WecomDmConfig;
  /**
   * Deprecated compatibility fields kept only while old webhook helpers are
   * being extracted into transport adapters.
   */
  aibotid?: string;
  token?: string;
  encodingAESKey?: string;
  botIds?: string[];
  ws?: WecomBotWsConfig;
  webhook?: WecomBotWebhookConfig;
};

/**
 * 上下游企业配置
 * 根据企业微信文档，只需要配置下游企业的 CorpID 和 AgentID
 * 不需要下游企业的 agentSecret，使用主企业的 corpSecret 获取下游企业的 access_token
 */
export type WecomUpstreamCorpConfig = {
  corpId: string;
  agentId: number;
};

export type WecomAgentConfig = {
  corpId: string;
  agentSecret?: string;
  /**
   * Deprecated compatibility alias for old configs.
   * New configs should use `agentSecret`.
   */
  corpSecret?: string;
  agentId?: number | string;
  token: string;
  encodingAESKey: string;
  welcomeText?: string;
  dm?: WecomDmConfig;
  /**
   * 上下游企业配置映射
   * key: 配置名称（可自定义）
   * value: 下游企业的 CorpID 和 AgentID
   * 
   * 注意：不需要配置 agentSecret，使用主企业的 corpSecret 获取下游企业的 access_token
   */
  upstreamCorps?: Record<string, WecomUpstreamCorpConfig>;
};

export type WecomDynamicAgentsConfig = {
  enabled?: boolean;
  dmCreateAgent?: boolean;
  groupEnabled?: boolean;
  adminUsers?: string[];
};

export type WecomAccountConfig = {
  enabled?: boolean;
  name?: string;
  mediaMaxMb?: number;
  bot?: WecomBotConfig;
  agent?: WecomAgentConfig;
};

export type WecomConfig = {
  enabled?: boolean;
  mediaMaxMb?: number;
  mediaDownloadTimeoutMs?: number;
  bot?: WecomBotConfig;
  agent?: WecomAgentConfig;
  accounts?: Record<string, WecomAccountConfig>;
  defaultAccount?: string;
  media?: WecomMediaConfig;
  network?: WecomNetworkConfig;
  routing?: WecomRoutingConfig;
  dynamicAgents?: WecomDynamicAgentsConfig;
};
