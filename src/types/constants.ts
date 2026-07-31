export const WEBHOOK_PATHS = {
  BOT: "/wecom/bot",
  BOT_ALT: "/wecom",
  AGENT: "/wecom/agent",
  BOT_PLUGIN: "/plugins/wecom/bot",
  AGENT_PLUGIN: "/plugins/wecom/agent",
} as const;

/** 企微开放接口域名，动态拼 path 的调用（日历、文档）直接用它。 */
export const API_BASE = "https://qyapi.weixin.qq.com";

export const API_ENDPOINTS = {
  GET_TOKEN: `${API_BASE}/cgi-bin/gettoken`,
  /** 上下游企业：用上游 token 换下游企业 token。 */
  GET_UPSTREAM_TOKEN: `${API_BASE}/cgi-bin/corpgroup/corp/gettoken`,
  SEND_MESSAGE: `${API_BASE}/cgi-bin/message/send`,
  SEND_APPCHAT: `${API_BASE}/cgi-bin/appchat/send`,
  UPLOAD_MEDIA: `${API_BASE}/cgi-bin/media/upload`,
  DOWNLOAD_MEDIA: `${API_BASE}/cgi-bin/media/get`,
} as const;

export const LIMITS = {
  TEXT_MAX_BYTES: 20_480,
  TOKEN_REFRESH_BUFFER_MS: 60_000,
  REQUEST_TIMEOUT_MS: 15_000,
  MAX_REQUEST_BODY_SIZE: 1024 * 1024,
  BOT_WEBHOOK_PASSIVE_WINDOW_MS: 5_000,
  BOT_WEBHOOK_RESPONSE_URL_TTL_MS: 60 * 60 * 1000,
  BOT_STREAM_WINDOW_MS: 6 * 60 * 1000,
  BOT_WS_HEARTBEAT_MS: 30_000,
} as const;

export const CRYPTO = {
  PKCS7_BLOCK_SIZE: 32,
  AES_KEY_LENGTH: 32,
} as const;
