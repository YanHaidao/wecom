import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import {
  resolveWecomEgressProxyUrl,
  resolveWecomMediaDownloadTimeoutMs,
  resolveWecomMediaMaxBytes,
} from "../config/index.js";
import { decryptWecomMediaWithMeta } from "../media.js";
import type { UnifiedInboundEvent } from "../types/index.js";
import type { NormalizedMediaAttachment } from "./media-types.js";

export class WecomMediaService {
  constructor(
    private readonly core: PluginRuntime,
    private readonly cfg: OpenClawConfig,
  ) {}

  private resolveInboundMaxBytes(accountId: string): number {
    return resolveWecomMediaMaxBytes(this.cfg, accountId);
  }

  async downloadRemoteMedia(params: {
    url: string;
    maxBytes: number;
  }): Promise<NormalizedMediaAttachment> {
    const loaded = await this.core.channel.media.fetchRemoteMedia({
      url: params.url,
      maxBytes: params.maxBytes,
    });
    return {
      buffer: loaded.buffer,
      contentType: loaded.contentType,
      filename: loaded.fileName,
    };
  }

  /**
   * Download and decrypt WeCom AES-encrypted media.
   * Bot-ws: each message carries a unique per-URL aeskey in the message body.
   * Bot-webhook: uses the account-level EncodingAESKey.
   * Both use AES-256-CBC with PKCS#7 padding (32-byte block), IV = key[:16].
   */
  async downloadEncryptedMedia(params: {
    url: string;
    aesKey: string;
    maxBytes: number;
  }): Promise<NormalizedMediaAttachment> {
    const proxyUrl = resolveWecomEgressProxyUrl(this.cfg);
    const timeoutMs = resolveWecomMediaDownloadTimeoutMs(this.cfg);
    const urlHost = (() => { try { return new URL(params.url).hostname; } catch { return "?"; } })();
    const t0 = Date.now();
    const decrypted = await decryptWecomMediaWithMeta(params.url, params.aesKey, {
      maxBytes: params.maxBytes,
      http: { proxyUrl, timeoutMs },
    });
    return {
      buffer: decrypted.buffer,
      contentType: decrypted.sourceContentType,
      filename: decrypted.sourceFilename,
    };
  }

  async saveInboundAttachment(
    event: UnifiedInboundEvent,
    attachment: NormalizedMediaAttachment,
  ): Promise<string> {
    const maxBytes = this.resolveInboundMaxBytes(event.accountId);
    const saved = await this.core.channel.media.saveMediaBuffer(
      attachment.buffer,
      attachment.contentType,
      "inbound",
      maxBytes,
      attachment.filename,
    );
    return saved.path;
  }

  async normalizeFirstAttachment(
    event: UnifiedInboundEvent,
  ): Promise<NormalizedMediaAttachment | undefined> {
    const first = event.attachments?.[0];
    if (!first?.remoteUrl) {
      return undefined;
    }
    // Keep fetch/decrypt/save on the same account-aware limit instead of falling back
    // to the core media store default (5MB).
    const maxBytes = this.resolveInboundMaxBytes(event.accountId);
    // Bot-ws media is AES-encrypted; use decryption when aesKey is present
    if (first.aesKey) {
      return this.downloadEncryptedMedia({ url: first.remoteUrl, aesKey: first.aesKey, maxBytes });
    }
    return this.downloadRemoteMedia({ url: first.remoteUrl, maxBytes });
  }
}
