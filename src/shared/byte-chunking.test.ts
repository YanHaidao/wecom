import { describe, expect, it } from "vitest";
import { chunkTextToByteLimit, splitByUtf8Bytes, utf8ByteLength } from "./byte-chunking.js";

/** 按字符定长切，模拟一个不认识语法边界的分片器。 */
const byChars = (text: string, limit: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += limit) out.push(text.slice(i, i + limit));
  return out;
};

/** 只在换行处切，模拟 SDK 那种认边界的分片器。 */
const byLines = (text: string, limit: number): string[] => {
  const out: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit && current) {
      out.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
};

describe("splitByUtf8Bytes", () => {
  it("keeps every piece within the byte limit", () => {
    const chunks = splitByUtf8Bytes("中".repeat(100), 30);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(30);
    }
    expect(chunks.join("")).toBe("中".repeat(100));
  });

  it("never splits a surrogate pair", () => {
    // 每个 emoji 是 4 字节、2 个 UTF-16 code unit。
    const chunks = splitByUtf8Bytes("😀".repeat(10), 9);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(9);
      // 半个代理对会变成 U+FFFD，往返后就不相等了。
      expect(Buffer.from(chunk, "utf8").toString("utf8")).toBe(chunk);
    }
    expect(chunks.join("")).toBe("😀".repeat(10));
  });

  it("emits a single oversized piece when one character exceeds the limit", () => {
    // 兜底行为：宁可超限也不丢字符。
    expect(splitByUtf8Bytes("中", 2)).toEqual(["中"]);
  });
});

describe("chunkTextToByteLimit", () => {
  it("returns the text untouched when it already fits", () => {
    expect(chunkTextToByteLimit("hello", 2048, byChars)).toEqual(["hello"]);
  });

  it("returns nothing for empty input", () => {
    expect(chunkTextToByteLimit("", 2048, byChars)).toEqual([]);
  });

  it("does not over-split pure ASCII", () => {
    // 密度为 1，字符上限应折算成字节上限本身，2049 字节只需切成 2 片。
    const text = "a".repeat(2049);
    const chunks = chunkTextToByteLimit(text, 2048, byChars);
    expect(chunks.length).toBe(2);
    expect(chunks.join("")).toBe(text);
  });

  it("keeps Chinese text within the byte limit, not the character limit", () => {
    // 2048 字符的中文约 6144 字节，按字符切会超 3 倍。
    const text = "中".repeat(2048);
    const chunks = chunkTextToByteLimit(text, 2048, byChars);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(2048);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("handles mixed-density text where the tail is denser than the average", () => {
    // 前半 ASCII、后半中文：全段平均密度会低估尾部，需要逐轮收紧。
    const text = "a".repeat(3000) + "中".repeat(1000);
    const chunks = chunkTextToByteLimit(text, 2048, byChars);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(2048);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("prefers the caller's break points over hard byte cuts", () => {
    const line = "中".repeat(40);
    const text = Array.from({ length: 30 }, () => line).join("\n");
    const chunks = chunkTextToByteLimit(text, 2048, byLines);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(2048);
      // 每片都由完整行组成，没有被从行中间劈开。
      for (const piece of chunk.split("\n")) {
        expect(piece === "" || piece === line).toBe(true);
      }
    }
    expect(chunks.join("\n")).toBe(text);
  });

  it("falls back to byte cuts when the splitter cannot break further", () => {
    // 没有换行，byLines 永远返回一整片，必须靠硬切兜住。
    const text = "中".repeat(3000);
    const chunks = chunkTextToByteLimit(text, 2048, byLines);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(2048);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("loses no content across a large mixed document", () => {
    const text = Array.from(
      { length: 200 },
      (_, i) => `## 第 ${i} 节标题\n正文内容 with some ASCII ${i}\n- 列表项 ${i}`,
    ).join("\n");
    const chunks = chunkTextToByteLimit(text, 2048, byLines);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(2048);
    }
    expect(chunks.join("\n")).toBe(text);
  });
});
