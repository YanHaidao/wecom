import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../transport/agent-api/core.js", () => ({
  sendText: vi.fn(),
  sendMarkdown: vi.fn(),
  sendMedia: vi.fn(),
  uploadMedia: vi.fn(),
}));

const agent = { accountId: "blue", corpId: "corp", agentId: 1000002 } as never;

/** Stands in for core's runtime; identity chunker keeps the assertions about format. */
const core = {
  channel: { text: { chunkText: (text: string) => [text] } },
} as never;

const cfgWith = (markdown?: Record<string, unknown>) =>
  ({
    channels: {
      wecom: {
        enabled: true,
        defaultAccount: "blue",
        accounts: {
          blue: {
            enabled: true,
            ...(markdown ? { markdown } : {}),
            agent: {
              corpId: "corp",
              corpSecret: "secret",
              agentId: 1000002,
              token: "t",
              encodingAESKey: "a",
            },
          },
        },
      },
    },
  }) as never;

describe("sendAgentDmText (bot timeout fallback)", () => {
  beforeEach(async () => {
    const api = await import("../../transport/agent-api/core.js");
    (api.sendText as never as { mockReset: () => void }).mockReset();
    (api.sendMarkdown as never as { mockReset: () => void }).mockReset();
  });

  it("sends markdown when the account is configured for it", async () => {
    const { sendAgentDmText } = await import("./fallback-delivery.js");
    const api = await import("../../transport/agent-api/core.js");

    await sendAgentDmText({
      agent,
      userId: "zhangsan",
      text: "**bold**",
      core,
      cfg: cfgWith({ format: "markdown" }),
    });

    expect(api.sendMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ toUser: "zhangsan", text: expect.stringContaining("bold") }),
    );
    expect(api.sendText).not.toHaveBeenCalled();
  });

  it("stays on plain text when the account is not configured", async () => {
    const { sendAgentDmText } = await import("./fallback-delivery.js");
    const api = await import("../../transport/agent-api/core.js");

    await sendAgentDmText({ agent, userId: "zhangsan", text: "**bold**", core, cfg: cfgWith() });

    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ toUser: "zhangsan", text: "**bold**" }),
    );
    expect(api.sendMarkdown).not.toHaveBeenCalled();
  });

  it("chunks converted markdown instead of truncating it", async () => {
    const { sendAgentDmText } = await import("./fallback-delivery.js");
    const api = await import("../../transport/agent-api/core.js");
    const { toWeComMarkdownV2 } = await import("../../wecom_msg_adapter/markdown_adapter.js");

    // Fits under 2048 as written, exceeds it once converted.
    const line = "![alt-text-here](https://example.com/some/image/path.png)";
    const text = Array.from({ length: 35 }, () => line).join("\n");
    expect(text.length).toBeLessThan(2048);
    expect(toWeComMarkdownV2(text).length).toBeGreaterThan(2048);

    await sendAgentDmText({
      agent,
      userId: "zhangsan",
      text,
      core,
      cfg: cfgWith({ format: "markdown" }),
    });

    const calls = (api.sendMarkdown as never as { mock: { calls: [{ text: string }][] } }).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    for (const [arg] of calls) {
      expect(arg.text.length).toBeLessThanOrEqual(2048);
    }
    expect(calls.map(([arg]) => arg.text).join("\n")).toContain("example.com/some/image/path.png");
  });
});
