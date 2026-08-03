import { describe, expect, it } from "vitest";
import {
  DEFAULT_WECOM_MARKDOWN_FORMAT,
  prepareWecomMarkdownChunks,
  prepareWecomTextChunks,
  resolveWecomMarkdownFormat,
} from "./markdown.js";
import { toWeComMarkdownV2 } from "../wecom_msg_adapter/markdown_adapter.js";
import { utf8ByteLength } from "../shared/byte-chunking.js";

function cfg(wecom: Record<string, unknown>) {
  return { channels: { wecom: { enabled: true, ...wecom } } } as never;
}

const account = (extra: Record<string, unknown> = {}) => ({
  enabled: true,
  agent: { corpId: "corp", corpSecret: "s", agentId: 1000001, token: "t", encodingAESKey: "a" },
  ...extra,
});

describe("resolveWecomMarkdownFormat", () => {
  it("defaults to text so existing behavior is unchanged", () => {
    expect(DEFAULT_WECOM_MARKDOWN_FORMAT).toBe("text");
    expect(resolveWecomMarkdownFormat(cfg({ accounts: { blue: account() } }), "blue")).toBe("text");
    expect(resolveWecomMarkdownFormat(cfg({}), null)).toBe("text");
  });

  it("reads the channel-level setting", () => {
    const c = cfg({ markdown: { format: "markdown" }, accounts: { blue: account() } });
    expect(resolveWecomMarkdownFormat(c, "blue")).toBe("markdown");
  });

  it("lets an account override the channel setting", () => {
    const c = cfg({
      markdown: { format: "markdown" },
      accounts: {
        blue: account({ markdown: { format: "text" } }),
        red: account(),
      },
    });
    expect(resolveWecomMarkdownFormat(c, "blue")).toBe("text");
    expect(resolveWecomMarkdownFormat(c, "red")).toBe("markdown");
  });

  it("applies account config to default-account sends that pass no accountId", () => {
    // Ordinary replies often arrive with accountId unset; without falling back to
    // the default account id, account-level config would silently never apply.
    const c = cfg({
      defaultAccount: "blue",
      accounts: {
        blue: account({ markdown: { format: "markdown" } }),
        red: account(),
      },
    });
    expect(resolveWecomMarkdownFormat(c, null)).toBe("markdown");
    expect(resolveWecomMarkdownFormat(c, undefined)).toBe("markdown");
    expect(resolveWecomMarkdownFormat(c, "   ")).toBe("markdown");
    expect(resolveWecomMarkdownFormat(c, "red")).toBe("text");
  });

  it("ignores unrecognized values and falls through", () => {
    expect(
      resolveWecomMarkdownFormat(
        cfg({ markdown: { format: "markdown" }, accounts: { blue: account({ markdown: { format: "textcard" } }) } }),
        "blue",
      ),
    ).toBe("markdown");
    expect(resolveWecomMarkdownFormat(cfg({ markdown: { format: 42 } }), null)).toBe("text");
    expect(resolveWecomMarkdownFormat(cfg({ markdown: {} }), null)).toBe("text");
  });

  it("accepts case and whitespace variations", () => {
    expect(resolveWecomMarkdownFormat(cfg({ markdown: { format: " Markdown " } }), null)).toBe("markdown");
    expect(resolveWecomMarkdownFormat(cfg({ markdown: { format: "TEXT" } }), null)).toBe("text");
  });
});

describe("prepareWecomMarkdownChunks", () => {
  it("converts before chunking, so growth past the limit splits instead of truncating", () => {
    // toWeComMarkdownV2 does not always shrink text; chunking first would let the
    // converted overflow get silently cut.
    const imgHeavy = Array.from(
      { length: 30 },
      (_, i) => `![img${i}](https://example.com/a/very/long/path/image-${i}.png)`,
    ).join("\n");
    const chunks = prepareWecomMarkdownChunks(imgHeavy, 500);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(500);
    }
    // Nothing dropped: every image survives somewhere in the output.
    const joined = chunks.join("");
    for (let i = 0; i < 30; i += 1) {
      expect(joined).toContain(`image-${i}.png`);
    }
  });

  it("keeps code fences balanced in every chunk", () => {
    // A fixed-length slice would leave one chunk holding an unterminated fence,
    // which renders as literal backticks.
    const text = `前言\n\n\`\`\`ts\n${"const x = 1; // ".repeat(50)}\n\`\`\`\n结尾`;
    const chunks = prepareWecomMarkdownChunks(text, 300);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const fences = chunk.match(/```/g) ?? [];
      expect(fences.length % 2).toBe(0);
    }
  });

  it("splits on line boundaries rather than mid-token", () => {
    const text = Array.from({ length: 20 }, (_, i) => `- **项目 ${i}**：这一行有一些说明文字`).join("\n");
    const chunks = prepareWecomMarkdownChunks(text, 200);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const markers = chunk.match(/\*\*/g) ?? [];
      expect(markers.length % 2).toBe(0);
    }
  });

  it("returns a single chunk when the converted text fits", () => {
    expect(prepareWecomMarkdownChunks("# hello", 2048)).toEqual([
      toWeComMarkdownV2("# hello", { flavor: "app", maxLength: null }),
    ]);
  });

  it("treats the limit as bytes, so Chinese splits well before 2048 characters", () => {
    // 2048 个中文字符约 6144 字节。按字符切会返回单片并被企微静默截断。
    const text = "中".repeat(2048);
    const chunks = prepareWecomMarkdownChunks(text, 2048);

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(2048);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("does not over-split ASCII that already fits in bytes", () => {
    // 密度为 1，2048 字节 = 2048 字符，不该有额外分片。
    const text = "a".repeat(2000);
    expect(prepareWecomMarkdownChunks(text, 2048)).toEqual([
      toWeComMarkdownV2(text, { flavor: "app", maxLength: null }),
    ]);
  });

  it("does not truncate at the converter's default 4096-character cap", () => {
    // toWeComMarkdownV2 默认在 4096 字符处静默截断。分片由调用方负责，
    // 所以这里必须关掉，否则长回复的尾巴根本到不了分片这步。
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i} padding text here`);
    const text = lines.join("\n");
    expect(text.length).toBeGreaterThan(4096);

    const joined = prepareWecomMarkdownChunks(text, 2048).join("\n");

    expect(joined).not.toContain("已截断");
    expect(joined).toContain("line 399");
  });

  it("downgrades syntax the app markdown subset does not support", () => {
    // 手册 90236 附录：自建应用 markdown 只有标题/加粗/链接/行内代码/引用/字体颜色。
    // 斜体与列表标记留着会原样显示成字面量。
    const chunks = prepareWecomMarkdownChunks("- 一项 *强调* 和 **加粗**", 2048);
    const out = chunks.join("");

    expect(out).toContain("• 一项");
    expect(out).toContain("强调");
    expect(out).not.toContain("*强调*");
    // 加粗仍是 app 子集支持的语法，不能被误拆。
    expect(out).toContain("**加粗**");
  });

  it("keeps emoji intact when the byte limit forces a split", () => {
    // 每个 emoji 4 字节，切错会留下半个代理对（渲染成 U+FFFD）。
    const text = "😀".repeat(200);
    const chunks = prepareWecomMarkdownChunks(text, 100);

    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(100);
      expect(Buffer.from(chunk, "utf8").toString("utf8")).toBe(chunk);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("applies batchChars as a tighter granularity without losing the byte ceiling", () => {
    const text = Array.from({ length: 40 }, (_, i) => `第 ${i} 行说明文字内容`).join("\n");
    const chunks = prepareWecomMarkdownChunks(text, 2048, 100);

    // 按 100 字符分批，所以片数远多于只受 2048 字节约束时。
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(2048);
    }
  });
});

describe("prepareWecomTextChunks", () => {
  const byChars = (text: string, limit: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += limit) out.push(text.slice(i, i + limit));
    return out;
  };

  it("holds Chinese text to the byte limit", () => {
    const text = "企业微信消息".repeat(400);
    const chunks = prepareWecomTextChunks(text, 2048, byChars);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(utf8ByteLength(chunk)).toBeLessThanOrEqual(2048);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("leaves short text as one chunk", () => {
    expect(prepareWecomTextChunks("hello", 2048, byChars)).toEqual(["hello"]);
  });
});
