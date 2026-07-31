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

/**
 * 各发送路径的消息长度上限，单位统一为 UTF-8 字节——企微手册的限制都以字节计。
 *
 * 注意不要按字符切分：纯中文每字符 3 字节，把字节上限当字符上限用会超出
 * 3 倍，而企微对 text 是「超过将截断」，不报错。分片走
 * shared/byte-chunking.ts 的 chunkTextToByteLimit。
 */
export const MESSAGE_BYTE_LIMITS = {
  /**
   * 自建应用 message/send 的 text 与 markdown，以及 appchat/send 的 text。
   * 三者都是 2048 字节。
   * https://developer.work.weixin.qq.com/document/path/90236
   * https://developer.work.weixin.qq.com/document/path/90248
   */
  AGENT_MESSAGE: 2_048,
  /**
   * 群机器人 webhook 的 markdown / markdown_v2。text 仍是 2048。
   * https://developer.work.weixin.qq.com/document/path/91770
   */
  BOT_WEBHOOK_MARKDOWN: 4_096,
  /** 群机器人 webhook 的 text。 */
  BOT_WEBHOOK_TEXT: 2_048,
  /**
   * 智能机器人 WS 流式回复的 stream.content。
   * 见 @wecom/aibot-node-sdk 的 StreamReplyBody：
   * 「回复内容（支持 Markdown），最长不超过 20480 个字节，必须是 utf8 编码」
   */
  BOT_WS_STREAM: 20_480,
} as const;

export const LIMITS = {
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
