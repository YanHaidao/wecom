import { describe, expect, it, vi } from "vitest";
import type { WecomWebhookTarget } from "./types.js";
import { handleEnterChat } from "./monitor.js";

describe("Webhook flow diagnostics", () => {
  it("keeps routing context while hiding the raw sender identifier", async () => {
    const rawSender = "zhangsan-sensitive-user-id";
    const log = vi.fn();
    const target = {
      account: {
        accountId: "default",
        welcomeText: "欢迎使用",
      },
      runtime: { log },
    } as unknown as WecomWebhookTarget;

    await expect(
      handleEnterChat(target, {
        msgtype: "event",
        msgid: "message-sensitive-id",
        from: { userid: rawSender },
        event: { eventtype: "enter_chat" },
      }),
    ).resolves.toEqual({ msgtype: "text", text: { content: "欢迎使用" } });

    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("stage=enter_chat");
    expect(output).toContain("account=default");
    expect(output).toContain("sender=");
    expect(output).not.toContain(rawSender);
    expect(output).not.toContain("message-sensitive-id");
  });
});
