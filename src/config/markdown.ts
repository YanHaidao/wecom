import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { chunkMarkdownText } from "openclaw/plugin-sdk/reply-runtime";
import { resolveDefaultWecomAccountId } from "./accounts.js";
import { toWeComMarkdownV2 } from "../wecom_msg_adapter/markdown_adapter.js";
import { chunkTextToByteLimit } from "../shared/byte-chunking.js";

/**
 * 企业微信文本渲染格式，按渠道/账号配置。
 *
 * OpenClaw 的模型是"markdown 渲染是渠道的固有能力，由配置决定"
 * （见 docs/concepts/markdown-formatting.md），所以这是账号级设置，
 * 不要求 Agent 每条消息自己选。
 *
 * - `text`：纯文本发送（默认，与本功能之前的行为一致）
 * - `markdown`：按企微 markdown 发送
 */
export type WecomMarkdownFormat = "text" | "markdown";

export const DEFAULT_WECOM_MARKDOWN_FORMAT: WecomMarkdownFormat = "text";

/** 归一化容忍大小写与首尾空格；非法值返回 undefined，交给调用方继续往下找。 */
export function normalizeWecomMarkdownFormat(value: unknown): WecomMarkdownFormat | undefined {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "text" || raw === "markdown" ? raw : undefined;
}

type WecomMarkdownSection = { format?: unknown } | undefined;

type WecomChannelMarkdownConfig =
  | {
      markdown?: WecomMarkdownSection;
      accounts?: Record<string, { markdown?: WecomMarkdownSection } | undefined>;
    }
  | undefined;

/**
 * 解析账号生效的文本格式：账号级 > 渠道级 > 默认（text）。
 * 与 resolveWecomMediaMaxBytes 的优先级写法保持一致。
 */
export function resolveWecomMarkdownFormat(
  cfg: OpenClawConfig,
  accountId?: string | null,
): WecomMarkdownFormat {
  const wecom = cfg.channels?.wecom as WecomChannelMarkdownConfig;
  // 默认账号发送时 accountId 常为空，回落到默认账号 id，
  // 否则账号级配置对默认账号不生效。
  const resolvedAccountId = accountId?.trim() || resolveDefaultWecomAccountId(cfg);
  if (resolvedAccountId) {
    const accountFormat = normalizeWecomMarkdownFormat(
      wecom?.accounts?.[resolvedAccountId]?.markdown?.format,
    );
    if (accountFormat) {
      return accountFormat;
    }
  }
  return normalizeWecomMarkdownFormat(wecom?.markdown?.format) ?? DEFAULT_WECOM_MARKDOWN_FORMAT;
}

/**
 * markdown 发送前的文本处理：先整体转换，再按 markdown 语法边界分片到字节上限。
 *
 * 顺序不能颠倒：`toWeComMarkdownV2` 不保证收缩文本（图片密集内容实测 +5%），
 * 先分片再转换会让超出上限的部分被截断。
 *
 * `flavor: "app"`：这几条路径都走自建应用的 `message/send` / `appchat/send`，
 * 它的 markdown 子集比群机器人的 markdown_v2 窄（没有斜体与列表）。
 *
 * `maxLength: null`：转换器默认会在 4096 字符处静默截断，而分片由下面的
 * chunkTextToByteLimit 负责，这里必须关掉，否则长回复的尾巴根本到不了分片这步。
 *
 * `maxBytes` 是 UTF-8 字节数，不是字符数——企微手册的限制都以字节计。
 * 断点仍由 chunkMarkdownText 选，否则 `**bold**` 或 `[text](url)`
 * 会被从中间劈开，两半都渲染不出来。
 *
 * `batchChars` 用于希望比字节上限更早分片的调用方（Agent 回调按 600 字符
 * 分批，让用户更早看到内容）。它只收紧粒度，字节上限仍然生效。
 */
export function prepareWecomMarkdownChunks(
  text: string,
  maxBytes: number,
  batchChars?: number,
): string[] {
  const converted = toWeComMarkdownV2(text, { flavor: "app", maxLength: null });
  const batched = batchChars ? chunkMarkdownText(converted, batchChars) : [converted];
  return batched.flatMap((piece) => chunkTextToByteLimit(piece, maxBytes, chunkMarkdownText));
}

/**
 * 纯文本发送前的分片，同样收到字节上限。
 *
 * 断点交给 SDK 的 chunkText（优先换行、其次空白），避免在词中间断开。
 */
export function prepareWecomTextChunks(
  text: string,
  maxBytes: number,
  splitByChars: (value: string, charLimit: number) => string[],
): string[] {
  return chunkTextToByteLimit(text, maxBytes, splitByChars);
}
