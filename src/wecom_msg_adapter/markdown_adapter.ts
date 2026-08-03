/**
 * 企业微信的两套 markdown 子集，语法范围不同，不能混用。
 *
 * - `v2`：群机器人 / 智能机器人的 `markdown_v2`（手册 91770）。
 *   支持斜体、列表、表格、图片、分割线、代码块，但不支持字体颜色。
 * - `app`：自建应用 `message/send` / `appchat/send` 的 `markdown`
 *   （手册 90236 附录）。只支持标题、加粗、链接、行内代码、引用、字体颜色，
 *   没有斜体与列表——留着这些标记会原样显示成字面量。
 */
export type WecomMarkdownFlavor = "app" | "v2";

export type ToWeComMarkdownOptions = {
  /** 目标语法子集，默认 `v2`。 */
  flavor?: WecomMarkdownFlavor;
  /**
   * 字符上限，超出按行截断并追加提示。
   *
   * 传 `null` 表示不截断——调用方自己按字节分片时必须这么传，
   * 否则超出部分会在分片之前就被这里静默吃掉。
   */
  maxLength?: number | null;
};

/**
 * 将较完整的 Markdown 降级转换为企业微信支持的 markdown 子集。
 *
 * 保守策略：
 * - 保留：标题、粗体、引用、链接、行内代码（`v2` 另外保留斜体与列表）
 * - 降级：代码块、图片、任务列表、分隔线、表格、HTML、脚注、复杂语法
 * - 清理：多余空行、非法控制字符、过深嵌套
 */
export function toWeComMarkdownV2(
  markdown: unknown,
  options: ToWeComMarkdownOptions = {},
): string {
  if (!markdown) return "";

  const { flavor = "v2", maxLength = 4096 } = options;

  let text = String(markdown).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const extracted = extractInlineCodeSpans(text);
  text = extracted.text;
  const inlineCodeStore = extracted.store;

  text = convertFencedCodeBlocks(text);
  text = convertIndentedCodeBlocks(text);
  text = convertImages(text);
  text = convertTaskLists(text);
  text = convertThematicBreaks(text);
  text = stripHtml(text);
  text = removeFootnotes(text);
  text = removeUnfriendlyExtensions(text);
  text = flattenDeepNesting(text);
  text = normalizeTables(text);
  if (flavor === "app") {
    text = downgradeToAppSubset(text);
  }
  text = restoreInlineCodeSpans(text, inlineCodeStore);
  text = cleanupWhitespace(text);

  if (maxLength != null && text.length > maxLength) {
    text = truncateSafely(text, maxLength);
  }

  return text;
}

/**
 * 把 `v2` 才支持的语法降到自建应用的子集。
 *
 * 必须在 restoreInlineCodeSpans 之前跑，行内代码此时还是占位符，
 * 不会被下面的正则误伤。
 */
function downgradeToAppSubset(text: string): string {
  // 斜体 -> 普通文本。两侧的 (?![*\w]) / (?<![*\w]) 保证 `**bold**` 不被拆开，
  // (?!\s) 保证行首的 `* item` 列表标记不被当成斜体。
  text = text.replace(/(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, "$1");
  // `_斜体_` 不处理：下划线在 URL 与标识符里太常见，剥掉的误伤大于收益。

  // 无序列表 -> 项目符号。有序列表保持原样，数字前缀本身就可读。
  text = text.replace(/^(\s*)[-*+][ \t]+/gm, "$1• ");

  return text;
}

const INLINE_CODE_PREFIX = "\uFFF0INLINECODE";
const INLINE_CODE_SUFFIX = "\uFFF1";

function extractInlineCodeSpans(text: string): { text: string; store: string[] } {
  const store: string[] = [];
  const replaced = text.replace(/`([^`\n]+?)`/g, (_, content: string) => {
    const idx = store.length;
    store.push(content);
    return `${INLINE_CODE_PREFIX}${idx}${INLINE_CODE_SUFFIX}`;
  });
  return { text: replaced, store };
}

function restoreInlineCodeSpans(text: string, store: string[]): string {
  const re = new RegExp(`${INLINE_CODE_PREFIX}(\\d+)${INLINE_CODE_SUFFIX}`, "g");
  return text.replace(re, (_, idxStr: string) => {
    const idx = Number(idxStr);
    const content = idx >= 0 && idx < store.length ? store[idx] : "";
    return `\`${content}\``;
  });
}

function convertFencedCodeBlocks(text: string): string {
  return text.replace(/```([a-zA-Z0-9_+\-]*)\n([\s\S]*?)```/g, (_, lang: string, code: string) => {
    const safeLang = (lang || "").trim();
    const safeCode = String(code || "").replace(/^\n+|\n+$/g, "");
    if (!safeCode.trim()) return "";

    const title = safeLang ? `代码（${safeLang}）：` : "代码：";
    return `\n${title}\n${safeCode}\n`;
  });
}

function convertIndentedCodeBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (!buffer.length) return;
    const block = buffer
      .map(line => (line.startsWith("    ") ? line.slice(4) : line))
      .join("\n")
      .replace(/\s+$/g, "");

    if (block) {
      out.push("代码：");
      out.push(...block.split("\n"));
    }
    buffer = [];
  };

  for (const line of lines) {
    if (/^    \S/.test(line)) {
      buffer.push(line);
    } else {
      flushBuffer();
      out.push(line);
    }
  }

  flushBuffer();
  return out.join("\n");
}

function convertImages(text: string): string {
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, url: string) => {
    const safeAlt = (alt || "").trim() || "图片";
    const safeUrl = (url || "").trim();
    return `[图片：${safeAlt}](${safeUrl})`;
  });

  text = text.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_, alt: string) => {
    const safeAlt = (alt || "").trim() || "图片";
    return `图片：${safeAlt}`;
  });

  return text;
}

function convertTaskLists(text: string): string {
  text = text.replace(/^(\s*[-*+]\s+)\[x\]\s+/gim, "✅ ");
  text = text.replace(/^(\s*[-*+]\s+)\[\s\]\s+/gm, "⬜ ");
  return text;
}

function convertThematicBreaks(text: string): string {
  return text.replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, "────────");
}

function stripHtml(text: string): string {
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p\s*>/gi, "\n");
  text = text.replace(/<p\b[^>]*>/gi, "");

  const simpleTags = [
    "div", "span", "b", "strong", "i", "em", "u",
    "font", "small", "big", "section", "article",
    "header", "footer", "main",
  ];

  for (const tag of simpleTags) {
    const re = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
    text = text.replace(re, "");
  }

  text = text.replace(/<[^>]+>/g, "");
  text = decodeHtmlEntities(text);

  return text;
}

function decodeHtmlEntities(text: string): string {
  const map: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&#39;": "'",
    "&nbsp;": " ",
  };

  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, m => map[m] ?? m);
}

function removeFootnotes(text: string): string {
  text = text.replace(/^\[\^[^\]]+\]:\s+.*(?:\n(?: {2,}|\t).*)*/gm, "");
  text = text.replace(/\[\^[^\]]+\]/g, "[注]");
  return text;
}

function removeUnfriendlyExtensions(text: string): string {
  text = text.replace(/~~(.*?)~~/g, "$1");
  text = text.replace(/==(.*?)==/g, "$1");
  text = text.replace(/(?<!~)~([^~\n]+)~(?!~)/g, "$1");
  text = text.replace(/\^([^^\n]+)\^/g, "$1");

  text = text.replace(
    /```(?:mermaid|math|latex|tex|graphviz|plantuml)\n([\s\S]*?)```/gi,
    "\n内容略（不支持的扩展块）\n",
  );

  return text;
}

function flattenDeepNesting(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  for (let line of lines) {
    if (/^\s{4,}[-*+]\s+/.test(line)) {
      line = line.replace(/^\s+/, "  ");
    }

    if (/^\s*(>\s*){2,}/.test(line)) {
      const content = line.replace(/^\s*(>\s*)+/, "");
      line = `> ${content}`;
    }

    out.push(line);
  }

  return out.join("\n");
}

function normalizeTables(text: string): string {
  // Pass 1: stitch broken table rows back together.
  // Models may split a single row across multiple lines in several ways:
  //   a) first part ends without |, continuation does NOT start with |
  //   b) first part ends without |, blank line(s), continuation starts with |
  //   c) first part ends without |, blank line(s), lone | on its own line
  // We absorb any blank lines that follow an incomplete row and keep merging
  // until the accumulated row ends with |.
  const rawLines = text.split("\n");
  const stitched: string[] = [];

  for (let idx = 0; idx < rawLines.length; idx++) {
    const line = rawLines[idx]!;
    const trimmed = line.trim();
    const prev = stitched[stitched.length - 1];
    const prevTrim = prev !== undefined ? prev.trim() : "";
    const prevIsIncomplete = prevTrim.startsWith("|") && !prevTrim.endsWith("|");

    if (prevIsIncomplete) {
      if (trimmed === "") {
        // Blank line inside a broken row — absorb it and keep waiting for the rest
        continue;
      }
      if (trimmed.includes("|")) {
        // Continuation (starting with | or not) — stitch into the pending row
        stitched[stitched.length - 1] =
          prev! + (trimmed.startsWith("|") ? trimmed : line);
        continue;
      }
    }

    stitched.push(line);
  }

  // Pass 2: convert each table block to plain text lines.
  const out: string[] = [];
  let i = 0;

  while (i < stitched.length) {
    if (looksLikeTableRow(stitched[i]!)) {
      const tableBlock: string[] = [stitched[i]!];
      let j = i + 1;

      while (j < stitched.length && looksLikeTableRow(stitched[j]!)) {
        tableBlock.push(stitched[j]!);
        j += 1;
      }

      if (out.length > 0 && out[out.length - 1]?.trim() !== "") {
        out.push("");
      }

      out.push(...tableToPlainText(tableBlock));

      if (j < stitched.length && stitched[j]?.trim() !== "") {
        out.push("");
      }

      i = j;
    } else {
      out.push(stitched[i]!);
      i += 1;
    }
  }

  return out.join("\n");
}

function looksLikeTableRow(line: string): boolean {
  const stripped = String(line).trim();
  if (!stripped.startsWith("|")) return false;
  return (stripped.match(/\|/g) || []).length >= 2;
}

function isTableSeparatorRow(row: string): boolean {
  const inner = row.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").every(c => /^[\s\-:]+$/.test(c) && c.includes("-"));
}

function extractTableCells(line: string): string[] {
  const raw = line.trim();
  const parts = raw.split("|");
  const inner = raw.startsWith("|") ? parts.slice(1) : parts;
  const cells = (raw.endsWith("|") ? inner.slice(0, -1) : inner).map(p => p.trim());
  return cells.filter(c => c.length > 0);
}

function tableToPlainText(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isTableSeparatorRow(line.trim())) continue;
    const cells = extractTableCells(line);
    if (cells.length === 0) continue;
    result.push(cells.join(" | "));
  }
  return result;
}

function cleanupWhitespace(text: string): string {
  const lines = text.split("\n").map(line => {
    let s = line.replace(/[ \t]+$/g, "");
    s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
    return s;
  });

  text = lines.join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function truncateSafely(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const suffix = "\n\n（内容过长，已截断）";
  const allowed = maxLength - suffix.length;
  if (allowed <= 0) return text.slice(0, maxLength);

  let truncated = text.slice(0, allowed);
  const cut = truncated.lastIndexOf("\n");
  if (cut > maxLength * 0.7) {
    truncated = truncated.slice(0, cut);
  }

  return truncated.replace(/\s+$/g, "") + suffix;
}
