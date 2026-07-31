/**
 * 用真实的分片代码跑一批样本，打印每片字节数并校验不超上限。
 *
 * 不发任何请求，只验证分片逻辑，所以可以随便跑。
 * 用法：node scripts/verify-byte-chunking.mjs
 */
import { chunkText, chunkMarkdownText } from "openclaw/plugin-sdk/reply-runtime";
import { chunkTextToByteLimit, utf8ByteLength } from "../dist/src/shared/byte-chunking.js";
import { prepareWecomMarkdownChunks } from "../dist/src/config/markdown.js";
import { MESSAGE_BYTE_LIMITS } from "../dist/src/types/constants.js";

const LIMIT = MESSAGE_BYTE_LIMITS.AGENT_MESSAGE;

const samples = [
  {
    name: "纯中文 1500 字（旧代码会整条超限被截断）",
    text: "企业微信长文本消息测试".repeat(137),
    mode: "text",
  },
  {
    name: "纯中文 3000 字",
    text: "这是一段用于验证分片的中文内容。".repeat(188),
    mode: "text",
  },
  {
    name: "中英混排",
    text: Array.from(
      { length: 120 },
      (_, i) => `第 ${i} 项：this is a mixed-language line with some ASCII payload ${i}`,
    ).join("\n"),
    mode: "text",
  },
  {
    name: "纯 ASCII 2000 字符（应保持单片，不该多切）",
    text: "a".repeat(2000),
    mode: "text",
  },
  {
    name: "纯 emoji 600 个（每个 4 字节 = 2400 字节）",
    text: "😀".repeat(600),
    mode: "text",
  },
  {
    name: "markdown：中文标题 + 列表",
    text: Array.from(
      { length: 60 },
      (_, i) => `## 第 ${i} 章节标题\n\n- **要点 ${i}**：这里是一段说明文字内容\n- 另一个要点`,
    ).join("\n\n"),
    mode: "markdown",
  },
  {
    name: "markdown：中文代码块",
    text: `前言说明\n\n\`\`\`ts\n${"const 变量 = '中文字符串值'; // 注释内容\n".repeat(60)}\`\`\`\n\n结尾说明`,
    mode: "markdown",
  },
  {
    name: "markdown：图片密集（转换后膨胀）",
    text: Array.from(
      { length: 40 },
      (_, i) => `![图片说明文字-${i}](https://example.com/a/long/path/image-${i}.png)`,
    ).join("\n"),
    mode: "markdown",
  },
];

let failures = 0;

for (const sample of samples) {
  const chunks =
    sample.mode === "markdown"
      ? prepareWecomMarkdownChunks(sample.text, LIMIT)
      : chunkTextToByteLimit(sample.text, LIMIT, chunkText);

  const byteSizes = chunks.map((c) => utf8ByteLength(c));
  const overLimit = byteSizes.filter((b) => b > LIMIT);
  const roundTrips = chunks.every((c) => Buffer.from(c, "utf8").toString("utf8") === c);

  // 比较时去掉空白：SDK 的 chunkText 在换行/空格处断开时会吃掉那个分隔符，
  // 这是它的既有行为（原先直接调它也一样）。这里要验的是实体内容没丢，
  // 不是字符级完全相等。markdown 路径还会转换 + 每片重开围栏，同样只比实体。
  const strip = (value) => value.replace(/\s+/g, "");
  const lossless = strip(chunks.join("")) === strip(sample.text);

  const problems = [];
  if (overLimit.length > 0) problems.push(`${overLimit.length} 片超过 ${LIMIT} 字节: ${overLimit}`);
  if (!lossless && sample.mode !== "markdown") problems.push("实体内容丢失或重复");
  if (!roundTrips) problems.push("有片包含被劈开的代理对（半个 emoji）");
  if (problems.length > 0) failures += 1;

  console.log(`\n${problems.length === 0 ? "PASS" : "FAIL"}  ${sample.name}`);
  console.log(
    `      输入 ${sample.text.length} 字符 / ${utf8ByteLength(sample.text)} 字节` +
      ` → ${chunks.length} 片`,
  );
  console.log(`      每片字节: [${byteSizes.join(", ")}]`);
  console.log(
    `      实体内容无损: ${lossless ? "是" : "否"}` +
      (!lossless && sample.mode === "markdown"
        ? "（markdown 预期：转换改写文本 + 每片重开围栏，不做等值比较）"
        : ""),
  );
  for (const problem of problems) console.log(`      ✗ ${problem}`);
}

console.log(
  `\n${failures === 0 ? "全部通过" : `${failures} 个样本有问题`}（上限 ${LIMIT} 字节，来自 MESSAGE_BYTE_LIMITS.AGENT_MESSAGE）`,
);
process.exit(failures === 0 ? 0 : 1);
