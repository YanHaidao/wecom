import { wecomFetch } from "../http.js";
import { resolveAddonEgressProxyUrl, type WecomAddonAgentAccount } from "./agent-account.js";
import { WECOM_ADDON_LIMITS, WECOM_API_BASE } from "./api-constants.js";

type TokenCache = {
  token: string;
  expiresAt: number;
  refreshPromise: Promise<string> | null;
};

const tokenCaches = new Map<string, TokenCache>();

/** Fetch and cache an Agent access token for enhanced API calls. */
export async function getAddonAccessToken(agent: WecomAddonAgentAccount): Promise<string> {
  const cacheKey = `${agent.corpId}:${String(agent.agentId ?? "na")}`;
  let cache = tokenCaches.get(cacheKey);
  if (!cache) {
    cache = { token: "", expiresAt: 0, refreshPromise: null };
    tokenCaches.set(cacheKey, cache);
  }

  const now = Date.now();
  if (cache.token && cache.expiresAt > now + WECOM_ADDON_LIMITS.tokenRefreshBufferMs) {
    return cache.token;
  }
  if (cache.refreshPromise) {
    return cache.refreshPromise;
  }

  cache.refreshPromise = (async () => {
    try {
      const url = `${WECOM_API_BASE}/cgi-bin/gettoken?corpid=${encodeURIComponent(agent.corpId)}&corpsecret=${encodeURIComponent(agent.corpSecret)}`;
      const response = await wecomFetch(url, undefined, {
        proxyUrl: resolveAddonEgressProxyUrl(agent.network),
        timeoutMs: WECOM_ADDON_LIMITS.requestTimeoutMs,
      });
      const body = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
        errcode?: number;
        errmsg?: string;
      };
      if (!body.access_token) {
        throw new Error(`gettoken failed: ${String(body.errcode)} ${String(body.errmsg)}`);
      }
      cache!.token = body.access_token;
      cache!.expiresAt = Date.now() + (body.expires_in ?? 7200) * 1000;
      return cache!.token;
    } finally {
      cache!.refreshPromise = null;
    }
  })();
  return cache.refreshPromise;
}
