import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { WecomConfig, WecomNetworkConfig } from "../types/index.js";

const DEFAULT_WECOM_MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;

function parsePositiveInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

export function resolveWecomEgressProxyUrlFromNetwork(network?: WecomNetworkConfig): string | undefined {
  const proxyUrl = network?.egressProxyUrl ??
    process.env.OPENCLAW_WECOM_EGRESS_PROXY_URL ??
    process.env.WECOM_EGRESS_PROXY_URL ??
    process.env.HTTPS_PROXY ??
    process.env.ALL_PROXY ??
    process.env.HTTP_PROXY ??
    "";
    
  return proxyUrl.trim() || undefined;
}

export function resolveWecomEgressProxyUrl(cfg: OpenClawConfig): string | undefined {
  const wecom = cfg.channels?.wecom as WecomConfig | undefined;
  return resolveWecomEgressProxyUrlFromNetwork(wecom?.network);
}

export function resolveWecomMediaDownloadTimeoutMs(cfg: OpenClawConfig): number {
  const wecom = cfg.channels?.wecom as
    | {
        media?: { downloadTimeoutMs?: unknown };
        mediaDownloadTimeoutMs?: unknown;
        network?: {
          mediaDownloadTimeoutMs?: unknown;
          timeoutMs?: unknown;
        };
      }
    | undefined;

  const timeoutMs =
    parsePositiveInt(wecom?.media?.downloadTimeoutMs) ??
    parsePositiveInt(wecom?.mediaDownloadTimeoutMs) ??
    parsePositiveInt(wecom?.network?.mediaDownloadTimeoutMs) ??
    parsePositiveInt(wecom?.network?.timeoutMs) ??
    parsePositiveInt(process.env.OPENCLAW_WECOM_MEDIA_TIMEOUT_MS) ??
    parsePositiveInt(process.env.WECOM_MEDIA_TIMEOUT_MS);

  return timeoutMs ?? DEFAULT_WECOM_MEDIA_DOWNLOAD_TIMEOUT_MS;
}
