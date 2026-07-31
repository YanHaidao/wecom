/**
 * 按 UTF-8 字节切分文本。
 *
 * 企微手册的长度限制全部以字节计（例如 message/send 的 text 与 markdown
 * 都是「最长不超过2048个字节」），而 SDK 的 chunkText / chunkMarkdownText
 * 是按字符（UTF-16 code unit）切的。纯中文每字符 3 字节，直接把字节上限
 * 当字符上限用会超出 3 倍，企微对 text 是「超过将截断」——不报错，
 * 内容被静默吃掉。
 *
 * 这里不直接按字节硬切，而是把边界选择交给传入的 splitByChars
 * （SDK 那两个分片器），只负责把字符上限收到字节达标为止。
 * 这样 `**bold**`、`[text](url)`、code fence 不会被从中间劈开。
 */

/** 收紧字符上限的重试轮数上限，超过就按字节硬切。 */
const MAX_TIGHTEN_ROUNDS = 6;

/** 每轮重试的收紧系数。 */
const TIGHTEN_FACTOR = 0.8;

export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * 按字节硬切，不看语法边界，但保证不把一个字符劈成两半。
 *
 * for...of 遍历码点，emoji 这类代理对不会被切开。
 * 仅在 splitByChars 切不动时兜底（例如整段落在同一个 code fence 内）。
 */
export function splitByUtf8Bytes(text: string, maxBytes: number): string[] {
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const char of text) {
    const charBytes = utf8ByteLength(char);
    if (currentBytes > 0 && currentBytes + charBytes > maxBytes) {
      out.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }

  if (current) out.push(current);
  return out;
}

/**
 * 按这段文本的实际字节密度折算字符上限。
 *
 * 不用固定除 4（最坏情况）或除 3（假定全中文）：纯 ASCII 密度是 1，
 * 折算后等于字节上限本身，不会白白多切一刀；中英混排介于 1 和 3 之间，
 * 也能一次命中。密度是全段平均值，若尾部更密会低估，靠 previousLimit
 * 逐轮收紧兜住。
 */
function nextCharLimit(piece: string, maxBytes: number, previousLimit: number): number {
  const density = utf8ByteLength(piece) / piece.length;
  const estimate = Math.floor(maxBytes / density);
  // 上一轮的上限没切够，说明平均密度低估了，这轮必须严格更紧，否则
  // splitByChars 会返回同样的结果，白转一圈。
  const tightened = Number.isFinite(previousLimit)
    ? Math.min(estimate, Math.floor(previousLimit * TIGHTEN_FACTOR))
    : estimate;
  return Math.max(1, tightened);
}

/**
 * 切分 text，保证每片的 UTF-8 字节数不超过 maxBytes。
 *
 * @param splitByChars 按字符上限切分的函数，负责选语法安全的断点
 *   （传 SDK 的 chunkText 或 chunkMarkdownText）。
 */
export function chunkTextToByteLimit(
  text: string,
  maxBytes: number,
  splitByChars: (value: string, charLimit: number) => string[],
): string[] {
  if (!text) return [];
  if (maxBytes <= 0) return [text];
  if (utf8ByteLength(text) <= maxBytes) return [text];

  const out: string[] = [];

  const visit = (piece: string, charLimit: number, round: number): void => {
    if (!piece) return;
    if (utf8ByteLength(piece) <= maxBytes) {
      out.push(piece);
      return;
    }
    if (round >= MAX_TIGHTEN_ROUNDS) {
      out.push(...splitByUtf8Bytes(piece, maxBytes));
      return;
    }

    const limit = nextCharLimit(piece, maxBytes, charLimit);
    const parts = splitByChars(piece, limit).filter((part) => part.length > 0);

    // 切不动：语法边界不允许再分（例如单个超长 code fence）。
    // 继续递归会死循环，改为按字节硬切。
    if (parts.length <= 1) {
      out.push(...splitByUtf8Bytes(piece, maxBytes));
      return;
    }

    for (const part of parts) visit(part, limit, round + 1);
  };

  visit(text, Number.POSITIVE_INFINITY, 0);
  return out;
}
