import { describe, expect, it } from "vitest";

import { shouldProcessBotInboundMessage } from "./monitor.js";

describe("shouldProcessBotInboundMessage", () => {
  it("skips payloads without sender id", () => {
    const result = shouldProcessBotInboundMessage({
      msgtype: "text",
      from: {},
      text: { content: "hello" },
    });
    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toBe("missing_sender");
  });

  it("skips system sender payloads", () => {
    const result = shouldProcessBotInboundMessage({
      msgtype: "text",
      from: { userid: "sys" },
      text: { content: "hello" },
    });
    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toBe("system_sender");
  });

  it("skips group payloads without chatid", () => {
    const result = shouldProcessBotInboundMessage({
      msgtype: "text",
      chattype: "group",
      from: { userid: "zhangsan" },
      text: { content: "hello" },
    });
    expect(result.shouldProcess).toBe(false);
    expect(result.reason).toBe("missing_chatid");
  });

  it("accepts normal direct-user messages", () => {
    const result = shouldProcessBotInboundMessage({
      msgtype: "text",
      chattype: "single",
      from: { userid: "zhangsan" },
      text: { content: "hello" },
    });
    expect(result.shouldProcess).toBe(true);
    expect(result.reason).toBe("user_message");
    expect(result.senderUserId).toBe("zhangsan");
    expect(result.chatId).toBe("zhangsan");
  });

  it("accepts normal group messages with chatid", () => {
    const result = shouldProcessBotInboundMessage({
      msgtype: "text",
      chattype: "group",
      chatid: "wr123",
      from: { userid: "zhangsan" },
      text: { content: "hello" },
    });
    expect(result.shouldProcess).toBe(true);
    expect(result.reason).toBe("user_message");
    expect(result.senderUserId).toBe("zhangsan");
    expect(result.chatId).toBe("wr123");
  });
});
