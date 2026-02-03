import { describe, expect, it, vi } from "vitest";

vi.mock("./agent/api-client.js", () => ({
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  uploadMedia: vi.fn(),
}));

describe("wecomOutbound", () => {
  it("does not crash when called with core outbound params", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    await expect(
      wecomOutbound.sendMedia({
        cfg: {},
        to: "wr-test-chat",
        text: "caption",
        mediaUrl: "https://example.com/media.png",
      } as any),
    ).rejects.toThrow(/Agent mode/i);
  });

  it("routes sendText to agent chatId/userid", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./agent/api-client.js");
    const now = vi.spyOn(Date, "now").mockReturnValue(123);
    (api.sendText as any).mockResolvedValue(undefined);

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          agent: {
            corpId: "corp",
            corpSecret: "secret",
            agentId: 1000002,
            token: "token",
            encodingAESKey: "aes",
          },
        },
      },
    };

    const chatResult = await wecomOutbound.sendText({
      cfg,
      to: "wr123",
      text: "hello",
    } as any);

    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "wr123",
        toUser: undefined,
        text: "hello",
      }),
    );
    expect(chatResult.channel).toBe("wecom");
    expect(chatResult.messageId).toBe("agent-123");

    (api.sendText as any).mockClear();

    const userResult = await wecomOutbound.sendText({
      cfg,
      to: "userid123",
      text: "hi",
    } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: undefined,
        toUser: "userid123",
        text: "hi",
      }),
    );
    expect(userResult.messageId).toBe("agent-123");

    now.mockRestore();
  });
});

