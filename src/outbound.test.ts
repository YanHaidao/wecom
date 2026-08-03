import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotWsPushHandle } from "./app/index.js";
import { utf8ByteLength } from "./shared/byte-chunking.js";

vi.mock("./transport/agent-api/core.js", () => ({
  sendMarkdown: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  uploadMedia: vi.fn(),
}));

describe("wecomOutbound", () => {
  async function createTempMediaFile(filename = "media.png"): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wecom-outbound-"));
    const filePath = path.join(dir, filename);
    await writeFile(filePath, Buffer.from([1, 2, 3]));
    return filePath;
  }

  const createBotWsHandle = (overrides: Partial<BotWsPushHandle> = {}): BotWsPushHandle => ({
    isConnected: () => true,
    sendMarkdown: vi.fn().mockResolvedValue(undefined),
    replyCommand: vi.fn().mockResolvedValue({ errcode: 0 }),
    sendMedia: vi.fn().mockResolvedValue({ ok: true, messageId: "ws-media-1" }),
    ...overrides,
  });

  // Loading ./outbound.js pulls in the whole channel graph and takes ~1.5s the
  // first time. Modules are never reset here, so that cost used to land on
  // whichever test imported first, pushing it past the 5s default timeout under
  // full-suite CPU contention. Pay it once up front instead.
  beforeAll(async () => {
    await import("./outbound.js");
  }, 60_000);

  beforeEach(async () => {
    const runtime = await import("./runtime.js");
    runtime.setWecomRuntime({
      channel: {
        text: {
          chunkText: (text: string) => [text],
        },
      },
    } as any);
  });

  afterEach(async () => {
    const runtime = await import("./runtime.js");
    const sourceRegistry = await import("./runtime/source-registry.js");
    runtime.unregisterBotWsPushHandle("default");
    runtime.unregisterBotWsPushHandle("acct-ws");
    runtime.unregisterActiveBotWsReplyHandle({
      accountId: "default",
      sessionKey: "agent:ops_bot:wecom:default:dm:zhangsan",
      peerKind: "direct",
      peerId: "zhangsan",
    });
    runtime.unregisterActiveBotWsReplyHandle({
      accountId: "acct-ws",
      sessionKey: "agent:ops_bot:wecom:acct-ws:dm:lisi",
      peerKind: "direct",
      peerId: "lisi",
    });
    sourceRegistry.clearWecomSourceAccount("default");
    sourceRegistry.clearWecomSourceAccount("acct-ws");
    vi.unstubAllGlobals();
  });

  it("does not crash when called with core outbound params", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    await expect(
      wecomOutbound.sendMedia({
        cfg: {},
        to: "wr-test-chat",
        text: "caption",
        mediaUrl: "https://example.com/media.png",
      } as any),
    ).rejects.toThrow(/requires Agent mode for account=default/i);
  });

  it("throws explicit error when outbound accountId does not exist", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          defaultAccount: "acct-a",
          accounts: {
            "acct-a": {
              enabled: true,
              agent: {
                corpId: "corp-a",
                corpSecret: "secret-a",
                agentId: 10001,
                token: "token-a",
                encodingAESKey: "aes-a",
              },
            },
          },
        },
      },
    };
    await expect(
      wecomOutbound.sendText({
        cfg,
        accountId: "acct-missing",
        to: "user:zhangsan",
        text: "hello",
      } as any),
    ).rejects.toThrow(/account "acct-missing" not found/i);
  });

  it("routes sendText to agent chatId/userid", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./transport/agent-api/core.js");
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

    // Chat ID (wr/wc) is intentionally NOT supported for Agent outbound.
    await expect(
      wecomOutbound.sendText({ cfg, to: "wr123", text: "hello" } as any),
    ).rejects.toThrow(/不支持向群 chatId 发送/);
    expect(api.sendText).not.toHaveBeenCalled();

    // Test: User ID (Default)
    const userResult = await wecomOutbound.sendText({
      cfg,
      to: "userid123",
      text: "hi",
    } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: undefined,
        toUser: "userid123",
        toParty: undefined,
        toTag: undefined,
        text: "hi",
      }),
    );
    expect(userResult.messageId).toBe("agent-123");

    (api.sendText as any).mockClear();

    // Test: User ID explicit
    await wecomOutbound.sendText({ cfg, to: "user:zhangsan", text: "hi" } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ toUser: "zhangsan", toParty: undefined }),
    );

    (api.sendText as any).mockClear();

    // Test: Numeric targets default to User ID
    await wecomOutbound.sendText({ cfg, to: "1001", text: "hi party" } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ toUser: "1001", toParty: undefined }),
    );

    (api.sendText as any).mockClear();

    // Test: Party ID Explicit
    await wecomOutbound.sendText({ cfg, to: "party:2002", text: "hi party 2" } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ toUser: undefined, toParty: "2002" }),
    );

    (api.sendText as any).mockClear();

    // Test: Tag ID Explicit
    await wecomOutbound.sendText({ cfg, to: "tag:1", text: "hi tag" } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ toUser: undefined, toTag: "1" }),
    );

    now.mockRestore();
  });

  describe("account markdown config", () => {
    // An ordinary agent reply reaches sendText carrying only core's outbound
    // fields, so account/channel config is the only lever that can affect it.
    const cfgWith = (markdown?: Record<string, unknown>) => ({
      channels: {
        wecom: {
          enabled: true,
          defaultAccount: "blue",
          accounts: {
            blue: {
              enabled: true,
              ...(markdown ? { markdown } : {}),
              agent: {
                corpId: "corp-blue",
                corpSecret: "secret",
                agentId: 1000015,
                token: "t",
                encodingAESKey: "a",
              },
            },
          },
        },
      },
    });

    it("sends a plain reply as markdown when the account is configured for it", async () => {
      const { wecomOutbound } = await import("./outbound.js");
      const api = await import("./transport/agent-api/core.js");
      (api.sendText as any).mockClear();
      (api.sendMarkdown as any).mockClear();
      (api.sendMarkdown as any).mockResolvedValue({ msgid: "cfg-md-1", deliveredFormat: "markdown" });

      const result = await wecomOutbound.sendText({
        cfg: cfgWith({ format: "markdown" }),
        to: "user:GuanXiaoPeng",
        text: "**bold** and `code`",
      } as any);

      expect(api.sendMarkdown).toHaveBeenCalled();
      expect(api.sendText).not.toHaveBeenCalled();
      expect(result.messageId).toBe("cfg-md-1");
    });

    it("reads the channel-level setting when the account has none", async () => {
      const { wecomOutbound } = await import("./outbound.js");
      const api = await import("./transport/agent-api/core.js");
      (api.sendText as any).mockClear();
      (api.sendMarkdown as any).mockClear();
      (api.sendMarkdown as any).mockResolvedValue({ msgid: "chan-md-1" });

      const cfg = {
        channels: {
          wecom: {
            enabled: true,
            markdown: { format: "markdown" },
            agent: { corpId: "corp", corpSecret: "secret", agentId: 1000002, token: "t", encodingAESKey: "a" },
          },
        },
      };

      await wecomOutbound.sendText({ cfg, to: "user:zhangsan", text: "# hi" } as any);

      expect(api.sendMarkdown).toHaveBeenCalled();
      expect(api.sendText).not.toHaveBeenCalled();
    });

    it("still sends plain text when the account is not configured", async () => {
      const { wecomOutbound } = await import("./outbound.js");
      const api = await import("./transport/agent-api/core.js");
      (api.sendText as any).mockClear();
      (api.sendMarkdown as any).mockClear();
      (api.sendText as any).mockResolvedValue({ msgid: "cfg-txt-1", deliveredFormat: "text" });

      await wecomOutbound.sendText({
        cfg: cfgWith(),
        to: "user:GuanXiaoPeng",
        text: "**bold**",
      } as any);

      expect(api.sendText).toHaveBeenCalled();
      expect(api.sendMarkdown).not.toHaveBeenCalled();
    });

    it("ignores unrecognized config values and stays on text", async () => {
      const { wecomOutbound } = await import("./outbound.js");
      const api = await import("./transport/agent-api/core.js");
      (api.sendText as any).mockClear();
      (api.sendMarkdown as any).mockClear();
      (api.sendText as any).mockResolvedValue({ msgid: "bad-cfg-1" });

      await wecomOutbound.sendText({
        cfg: cfgWith({ format: "textcard" }),
        to: "user:GuanXiaoPeng",
        text: "hi",
      } as any);

      expect(api.sendText).toHaveBeenCalled();
      expect(api.sendMarkdown).not.toHaveBeenCalled();
    });
  });

  it("routes markdown to the Agent markdown API and uses the returned msgid", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./transport/agent-api/core.js");
    (api.sendText as any).mockClear();
    (api.sendMarkdown as any).mockClear();
    (api.sendMarkdown as any).mockResolvedValue({ msgid: "wecom-md-1" });

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          markdown: { format: "markdown" },
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

    const result = await wecomOutbound.sendText({
      cfg,
      to: "user:zhangsan",
      text: "**hello**",
    } as any);

    expect(api.sendText).not.toHaveBeenCalled();
    expect(api.sendMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "zhangsan",
        text: expect.stringContaining("hello"),
      }),
    );
    expect(result.messageId).toBe("wecom-md-1");
  });

  it("converts markdown before chunking so conversion growth is not truncated", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./transport/agent-api/core.js");
    (api.sendMarkdown as any).mockClear();
    (api.sendMarkdown as any).mockResolvedValue({ msgid: "chunk-1" });

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          markdown: { format: "markdown" },
          agent: { corpId: "corp", corpSecret: "secret", agentId: 1000002, token: "t", encodingAESKey: "a" },
        },
      },
    };

    // Markdown image syntax expands during conversion. Just under the 2048 limit
    // before conversion, over it after — so it must be split, not silently cut.
    const line = "![alt-text-here](https://example.com/some/image/path.png)";
    const text = Array.from({ length: 35 }, () => line).join("\n");
    const { toWeComMarkdownV2 } = await import("./wecom_msg_adapter/markdown_adapter.js");
    // Input fits in one chunk; the converted form does not.
    expect(text.length).toBeLessThan(2048);
    expect(toWeComMarkdownV2(text, { flavor: "app", maxLength: null }).length).toBeGreaterThan(2048);

    await wecomOutbound.sendText({ cfg, to: "user:zhangsan", text } as any);

    const calls = (api.sendMarkdown as any).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    for (const [arg] of calls) {
      expect(utf8ByteLength(arg.text)).toBeLessThanOrEqual(2048);
    }
    // No content lost: every chunk together still carries all the links.
    const joined = calls.map(([arg]: any[]) => arg.text).join("\n");
    expect(joined).toContain("example.com/some/image/path.png");
  });

  it("splits long Chinese replies on bytes, not characters", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./transport/agent-api/core.js");
    (api.sendText as any).mockClear();
    (api.sendText as any).mockResolvedValue({ msgid: "cn-1" });

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          agent: { corpId: "corp", corpSecret: "secret", agentId: 1000002, token: "t", encodingAESKey: "a" },
        },
      },
    };

    // Under 2048 characters but well over 2048 bytes — WeCom would truncate it.
    const text = "企业微信长文本消息".repeat(167);
    expect(text.length).toBeLessThan(2048);
    expect(utf8ByteLength(text)).toBeGreaterThan(2048);

    await wecomOutbound.sendText({ cfg, to: "user:zhangsan", text } as any);

    const calls = (api.sendText as any).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    for (const [arg] of calls) {
      expect(utf8ByteLength(arg.text)).toBeLessThanOrEqual(2048);
    }
    expect(calls.map(([arg]: any[]) => arg.text).join("")).toBe(text);
  });

  it("suppresses /new ack for bot sessions but not agent sessions", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./transport/agent-api/core.js");
    const sourceRegistry = await import("./runtime/source-registry.js");
    const now = vi.spyOn(Date, "now").mockReturnValue(456);
    (api.sendText as any).mockResolvedValue(undefined);
    (api.sendText as any).mockClear();

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

    const ack = "✅ New session started · model: openai-codex/gpt-5.2";

    // Bot 会话（wecom:...）应抑制，避免私信回执
    const r1 = await wecomOutbound.sendText({ cfg, to: "wecom:userid123", text: ack } as any);
    expect(api.sendText).not.toHaveBeenCalled();
    expect(r1.messageId).toBe("suppressed-456");

    (api.sendText as any).mockClear();

    sourceRegistry.registerWecomSourceSnapshot({
      accountId: "default",
      source: "agent-callback",
      sessionKey: "agent:ops_bot:wecom:default:dm:userid123",
      peerKind: "direct",
      peerId: "userid123",
    });

    // Agent 会话允许发送回执，即使 target 是普通 wecom:user:...
    await wecomOutbound.sendText({
      cfg,
      accountId: "default",
      sessionKey: "agent:ops_bot:wecom:default:dm:userid123",
      to: "wecom:user:userid123",
      text: ack,
    } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "userid123",
        text: "✅ 已开启新会话（模型：openai-codex/gpt-5.2）",
      }),
    );

    now.mockRestore();
  });

  it("prefers Bot WS active push for text when ws is the active bot transport", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const api = await import("./transport/agent-api/core.js");
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const now = vi.spyOn(Date, "now").mockReturnValue(789);
    runtime.registerBotWsPushHandle(
      "acct-ws",
      createBotWsHandle({
        sendMarkdown,
      }),
    );
    (api.sendText as any).mockClear();

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          defaultAccount: "acct-ws",
          accounts: {
            "acct-ws": {
              enabled: true,
              bot: {
                primaryTransport: "ws",
                ws: {
                  botId: "bot-1",
                  secret: "secret-1",
                },
              },
              agent: {
                corpId: "corp-ws",
                corpSecret: "agent-secret",
                agentId: 10001,
                token: "token-ws",
                encodingAESKey: "aes-ws",
              },
            },
          },
        },
      },
    };

    const result = await wecomOutbound.sendText({
      cfg,
      accountId: "acct-ws",
      to: "user:lisi",
      text: "hello ws",
    } as any);

    expect(sendMarkdown).toHaveBeenCalledWith("lisi", "hello ws");
    expect(api.sendText).not.toHaveBeenCalled();
    expect(result.messageId).toBe("bot-ws-789");

    now.mockRestore();
  });

  it("always delivers Bot WS as markdown, the only msgtype that transport has", async () => {
    // The Bot WS SDK's SendMsgBody has no text msgtype, so markdown.format does
    // not apply to this transport — it renders as markdown either way.
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    runtime.registerBotWsPushHandle("acct-ws", createBotWsHandle({ sendMarkdown }));

    const cfg = (markdown?: Record<string, unknown>) => ({
      channels: {
        wecom: {
          enabled: true,
          defaultAccount: "acct-ws",
          accounts: {
            "acct-ws": {
              enabled: true,
              ...(markdown ? { markdown } : {}),
              bot: { primaryTransport: "ws", ws: { botId: "bot-1", secret: "secret-1" } },
              agent: {
                corpId: "corp-ws",
                corpSecret: "agent-secret",
                agentId: 10001,
                token: "token-ws",
                encodingAESKey: "aes-ws",
              },
            },
          },
        },
      },
    });

    // Whether markdown.format is unset or explicitly "text", this transport
    // still delivers markdown.
    for (const [label, markdown] of [
      ["unconfigured", undefined],
      ["configured text", { format: "text" }],
      ["configured markdown", { format: "markdown" }],
    ] as const) {
      sendMarkdown.mockClear();
      await wecomOutbound.sendText({
        cfg: cfg(markdown as Record<string, unknown> | undefined),
        accountId: "acct-ws",
        to: "user:lisi",
        text: "**bold**",
      } as any);

      expect(sendMarkdown, label).toHaveBeenCalled();
    }
  });

  it("keeps agent-source sessions on the Agent text path even when ws is primary", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const api = await import("./transport/agent-api/core.js");
    const sourceRegistry = await import("./runtime/source-registry.js");
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    runtime.registerBotWsPushHandle(
      "acct-ws",
      createBotWsHandle({
        sendMarkdown,
      }),
    );
    sourceRegistry.registerWecomSourceSnapshot({
      accountId: "acct-ws",
      source: "agent-callback",
      sessionKey: "agent:ops_bot:wecom:acct-ws:dm:lisi",
    });
    (api.sendText as any).mockResolvedValue(undefined);
    (api.sendText as any).mockClear();

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          defaultAccount: "acct-ws",
          accounts: {
            "acct-ws": {
              enabled: true,
              bot: {
                primaryTransport: "ws",
                ws: {
                  botId: "bot-1",
                  secret: "secret-1",
                },
              },
              agent: {
                corpId: "corp-ws",
                corpSecret: "agent-secret",
                agentId: 10001,
                token: "token-ws",
                encodingAESKey: "aes-ws",
              },
            },
          },
        },
      },
    };

    await wecomOutbound.sendText({
      cfg,
      accountId: "acct-ws",
      sessionKey: "agent:ops_bot:wecom:acct-ws:dm:lisi",
      to: "user:lisi",
      text: "hello agent",
    } as any);

    expect(sendMarkdown).not.toHaveBeenCalled();
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "lisi",
        text: "hello agent",
      }),
    );
  });

  it("keeps agent-source peer targets on the Agent text path without sessionKey", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const api = await import("./transport/agent-api/core.js");
    const sourceRegistry = await import("./runtime/source-registry.js");
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    runtime.registerBotWsPushHandle(
      "acct-ws",
      createBotWsHandle({
        sendMarkdown,
      }),
    );
    sourceRegistry.registerWecomSourceSnapshot({
      accountId: "acct-ws",
      source: "agent-callback",
      peerKind: "direct",
      peerId: "lisi",
    });
    (api.sendText as any).mockResolvedValue(undefined);
    (api.sendText as any).mockClear();

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          defaultAccount: "acct-ws",
          accounts: {
            "acct-ws": {
              enabled: true,
              bot: {
                primaryTransport: "ws",
                ws: {
                  botId: "bot-1",
                  secret: "secret-1",
                },
              },
              agent: {
                corpId: "corp-ws",
                corpSecret: "agent-secret",
                agentId: 10001,
                token: "token-ws",
                encodingAESKey: "aes-ws",
              },
            },
          },
        },
      },
    };

    await wecomOutbound.sendText({
      cfg,
      accountId: "acct-ws",
      to: "user:lisi",
      text: "hello peer",
    } as any);

    expect(sendMarkdown).not.toHaveBeenCalled();
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "lisi",
        text: "hello peer",
      }),
    );
  });

  it("does not silently fall back to Agent when Bot WS active push is configured but unavailable", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./transport/agent-api/core.js");
    (api.sendText as any).mockClear();

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          bot: {
            primaryTransport: "ws",
            ws: {
              botId: "bot-1",
              secret: "secret-1",
            },
          },
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

    await expect(
      wecomOutbound.sendText({
        cfg,
        to: "user:zhangsan",
        text: "hello",
      } as any),
    ).rejects.toThrow(/no live ws runtime is registered/i);
    expect(api.sendText).not.toHaveBeenCalled();
  });

  it("prefers Bot WS for outbound media when ws is the active bot transport", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const api = await import("./transport/agent-api/core.js");
    const sendMedia = vi.fn().mockResolvedValue({ ok: true, messageId: "ws-media-1" });
    runtime.registerBotWsPushHandle(
      "default",
      createBotWsHandle({
        sendMedia,
      }),
    );
    (api.uploadMedia as any).mockResolvedValue("media-1");
    (api.sendMedia as any).mockResolvedValue(undefined);
    (api.sendMedia as any).mockClear();

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          bot: {
            primaryTransport: "ws",
            ws: {
              botId: "bot-1",
              secret: "secret-1",
            },
          },
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

    await wecomOutbound.sendMedia({
      cfg,
      to: "user:zhangsan",
      text: "caption",
      mediaUrl: "https://example.com/media.png",
    } as any);

    expect(sendMedia).toHaveBeenCalledWith({
      chatId: "zhangsan",
      maxBytes: 80 * 1024 * 1024,
      mediaUrl: "https://example.com/media.png",
      mediaLocalRoots: expect.any(Array),
      text: "caption",
    });
    expect(api.sendMedia).not.toHaveBeenCalled();
  });

  it("marks the active bot-ws reply handle when same-session text is sent via active push", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const api = await import("./transport/agent-api/core.js");
    const sendMarkdown = vi.fn().mockResolvedValue(undefined);
    const markExternalActivity = vi.fn();
    runtime.registerBotWsPushHandle(
      "acct-ws",
      createBotWsHandle({
        sendMarkdown,
      }),
    );
    runtime.registerActiveBotWsReplyHandle({
      accountId: "acct-ws",
      sessionKey: "agent:ops_bot:wecom:acct-ws:dm:lisi",
      peerKind: "direct",
      peerId: "lisi",
      handle: {
        context: {
          transport: "bot-ws",
          accountId: "acct-ws",
          raw: { transport: "bot-ws", envelopeType: "ws", body: {} },
        },
        deliver: vi.fn(),
        markExternalActivity,
      } as any,
    });
    (api.sendText as any).mockClear();

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          defaultAccount: "acct-ws",
          accounts: {
            "acct-ws": {
              enabled: true,
              bot: {
                primaryTransport: "ws",
                ws: {
                  botId: "bot-1",
                  secret: "secret-1",
                },
              },
              agent: {
                corpId: "corp-ws",
                corpSecret: "agent-secret",
                agentId: 10001,
                token: "token-ws",
                encodingAESKey: "aes-ws",
              },
            },
          },
        },
      },
    };

    await wecomOutbound.sendText({
      cfg,
      accountId: "acct-ws",
      sessionKey: "agent:ops_bot:wecom:acct-ws:dm:lisi",
      to: "user:lisi",
      text: "hello ws",
    } as any);

    expect(sendMarkdown).toHaveBeenCalledWith("lisi", "hello ws");
    expect(markExternalActivity).toHaveBeenCalledTimes(1);
    expect(api.sendText).not.toHaveBeenCalled();
  });

  it("keeps agent-source sessions on the Agent media path even when ws is primary", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const api = await import("./transport/agent-api/core.js");
    const sourceRegistry = await import("./runtime/source-registry.js");
    const sendMedia = vi.fn().mockResolvedValue({ ok: true, messageId: "ws-media-1" });
    runtime.registerBotWsPushHandle(
      "default",
      createBotWsHandle({
        sendMedia,
      }),
    );
    sourceRegistry.registerWecomSourceSnapshot({
      accountId: "default",
      source: "agent-callback",
      sessionKey: "agent:ops_bot:wecom:default:dm:zhangsan",
    });
    (api.uploadMedia as any).mockResolvedValue("media-1");
    (api.sendMedia as any).mockResolvedValue(undefined);
    (api.sendMedia as any).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: new Headers({ "content-type": "image/png" }),
      }),
    );

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          bot: {
            primaryTransport: "ws",
            ws: {
              botId: "bot-1",
              secret: "secret-1",
            },
          },
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

    const mediaUrl = await createTempMediaFile("media.png");

    await wecomOutbound.sendMedia({
      cfg,
      sessionKey: "agent:ops_bot:wecom:default:dm:zhangsan",
      to: "user:zhangsan",
      text: "caption",
      mediaUrl,
    } as any);

    expect(sendMedia).not.toHaveBeenCalled();
    expect(api.sendMedia).toHaveBeenCalledTimes(1);
  });

  it("marks the active bot-ws reply handle when same-session media is sent via active push", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const sendMedia = vi.fn().mockResolvedValue({ ok: true, messageId: "ws-media-1" });
    const markExternalActivity = vi.fn();
    runtime.registerBotWsPushHandle(
      "default",
      createBotWsHandle({
        sendMedia,
      }),
    );
    runtime.registerActiveBotWsReplyHandle({
      accountId: "default",
      sessionKey: "agent:ops_bot:wecom:default:dm:zhangsan",
      peerKind: "direct",
      peerId: "zhangsan",
      handle: {
        context: {
          transport: "bot-ws",
          accountId: "default",
          raw: { transport: "bot-ws", envelopeType: "ws", body: {} },
        },
        deliver: vi.fn(),
        markExternalActivity,
      } as any,
    });

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          bot: {
            primaryTransport: "ws",
            ws: {
              botId: "bot-1",
              secret: "secret-1",
            },
          },
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

    await wecomOutbound.sendMedia({
      cfg,
      sessionKey: "agent:ops_bot:wecom:default:dm:zhangsan",
      to: "user:zhangsan",
      text: "caption",
      mediaUrl: "https://example.com/media.png",
    } as any);

    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(markExternalActivity).toHaveBeenCalledTimes(1);
  });

  it("keeps agent-source peer targets on the Agent media path without sessionKey", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const api = await import("./transport/agent-api/core.js");
    const sourceRegistry = await import("./runtime/source-registry.js");
    const sendMedia = vi.fn().mockResolvedValue({ ok: true, messageId: "ws-media-1" });
    runtime.registerBotWsPushHandle(
      "default",
      createBotWsHandle({
        sendMedia,
      }),
    );
    sourceRegistry.registerWecomSourceSnapshot({
      accountId: "default",
      source: "agent-callback",
      peerKind: "direct",
      peerId: "zhangsan",
    });
    (api.uploadMedia as any).mockResolvedValue("media-1");
    (api.sendMedia as any).mockResolvedValue(undefined);
    (api.sendMedia as any).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: new Headers({ "content-type": "image/png" }),
      }),
    );

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          bot: {
            primaryTransport: "ws",
            ws: {
              botId: "bot-1",
              secret: "secret-1",
            },
          },
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

    const mediaUrl = await createTempMediaFile("media.png");

    await wecomOutbound.sendMedia({
      cfg,
      to: "user:zhangsan",
      text: "caption",
      mediaUrl,
    } as any);

    expect(sendMedia).not.toHaveBeenCalled();
    expect(api.sendMedia).toHaveBeenCalledTimes(1);
  });

  it("merges configured media local roots into Bot WS sends", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const sendMedia = vi.fn().mockResolvedValue({ ok: true, messageId: "ws-media-merged" });
    runtime.registerBotWsPushHandle(
      "default",
      createBotWsHandle({
        sendMedia,
      }),
    );

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          bot: {
            primaryTransport: "ws",
            ws: {
              botId: "bot-1",
              secret: "secret-1",
            },
          },
          media: {
            localRoots: ["/tmp/downloads"],
          },
        },
      },
    };

    await wecomOutbound.sendMedia({
      cfg,
      to: "user:zhangsan",
      mediaUrl: "/tmp/workspace-agent/01.png",
      mediaLocalRoots: ["/tmp/workspace-agent"],
    } as any);

    expect(sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "zhangsan",
        mediaUrl: "/tmp/workspace-agent/01.png",
        mediaLocalRoots: expect.arrayContaining(["/tmp/workspace-agent", "/tmp/downloads"]),
        text: undefined,
      }),
    );
  });

  it("passes account-aware mediaMaxMb to Bot WS media sends", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const sendMedia = vi.fn().mockResolvedValue({ ok: true, messageId: "ws-media-limit" });
    runtime.registerBotWsPushHandle(
      "acct-ws",
      createBotWsHandle({
        sendMedia,
      }),
    );

    const cfg = {
      agents: {
        defaults: {
          mediaMaxMb: 12,
        },
      },
      channels: {
        wecom: {
          enabled: true,
          mediaMaxMb: 24,
          accounts: {
            "acct-ws": {
              enabled: true,
              mediaMaxMb: 36,
              bot: {
                primaryTransport: "ws",
                ws: {
                  botId: "bot-1",
                  secret: "secret-1",
                },
              },
            },
          },
        },
      },
    };

    await wecomOutbound.sendMedia({
      cfg,
      accountId: "acct-ws",
      to: "user:zhangsan",
      mediaUrl: "https://example.com/media.png",
    } as any);

    expect(sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "zhangsan",
        maxBytes: 36 * 1024 * 1024,
      }),
    );
  });

  it("does not fall back to Agent media when Bot WS conversation media delivery fails", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const api = await import("./transport/agent-api/core.js");
    const sendMedia = vi.fn().mockResolvedValue({ ok: false, error: "upload failed" });
    runtime.registerBotWsPushHandle(
      "default",
      createBotWsHandle({
        sendMedia,
      }),
    );
    (api.uploadMedia as any).mockResolvedValue("media-1");
    (api.sendMedia as any).mockResolvedValue(undefined);
    (api.sendMedia as any).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: new Headers({ "content-type": "image/png" }),
      }),
    );

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          bot: {
            primaryTransport: "ws",
            ws: {
              botId: "bot-1",
              secret: "secret-1",
            },
          },
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

    await expect(
      wecomOutbound.sendMedia({
        cfg,
        to: "user:zhangsan",
        text: "caption",
        mediaUrl: "https://example.com/media.png",
      } as any),
    ).rejects.toThrow(/Bot WS media delivery failed/i);

    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(api.sendMedia).not.toHaveBeenCalled();
  });

  it("keeps explicit agent targets on the Agent media path", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const runtime = await import("./runtime.js");
    const api = await import("./transport/agent-api/core.js");
    const sendMedia = vi.fn().mockResolvedValue({ ok: true, messageId: "ws-media-1" });
    runtime.registerBotWsPushHandle(
      "default",
      createBotWsHandle({
        sendMedia,
      }),
    );
    (api.uploadMedia as any).mockResolvedValue("media-1");
    (api.sendMedia as any).mockResolvedValue(undefined);
    (api.sendMedia as any).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: new Headers({ "content-type": "image/png" }),
      }),
    );

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          bot: {
            primaryTransport: "ws",
            ws: {
              botId: "bot-1",
              secret: "secret-1",
            },
          },
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

    const mediaUrl = await createTempMediaFile("media.png");

    await wecomOutbound.sendMedia({
      cfg,
      to: "wecom-agent:default:user:zhangsan",
      text: "caption",
      mediaUrl,
    } as any);

    expect(sendMedia).not.toHaveBeenCalled();
    expect(api.sendMedia).toHaveBeenCalledTimes(1);
  });

  it("routes explicit upstream agent text targets to the upstream delivery path", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./transport/agent-api/core.js");
    const client = await import("./transport/agent-api/client.js");
    const upstreamSpy = vi.spyOn(client, "sendUpstreamAgentApiText").mockResolvedValue(undefined);
    (api.sendText as any).mockClear();

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          agent: {
            corpId: "corp-main",
            corpSecret: "secret-main",
            agentId: 1000002,
            token: "token-main",
            encodingAESKey: "aes-main",
            upstreamCorps: {
              partner: {
                corpId: "corp-up",
                agentId: 2000001,
              },
            },
          },
        },
      },
    };

    await wecomOutbound.sendText({
      cfg,
      to: "wecom-agent-upstream:default:corp-up:zhangsan",
      text: "hello upstream",
    } as any);

    expect(upstreamSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "zhangsan",
        text: "hello upstream",
        upstreamAgent: expect.objectContaining({
          corpId: "corp-up",
          agentId: 2000001,
        }),
        primaryAgent: expect.objectContaining({
          corpId: "corp-main",
          agentId: 1000002,
        }),
      }),
    );
    expect(api.sendText).not.toHaveBeenCalled();

    upstreamSpy.mockRestore();
  });

  it("honors markdown config on the upstream delivery path", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const client = await import("./transport/agent-api/client.js");
    const textSpy = vi.spyOn(client, "sendUpstreamAgentApiText").mockResolvedValue(undefined as never);
    const markdownSpy = vi
      .spyOn(client, "sendUpstreamAgentApiMarkdown")
      .mockResolvedValue({ msgid: "up-md-cfg-1" } as never);

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          markdown: { format: "markdown" },
          agent: {
            corpId: "corp-main",
            corpSecret: "secret-main",
            agentId: 1000002,
            token: "token-main",
            encodingAESKey: "aes-main",
            upstreamCorps: { partner: { corpId: "corp-up", agentId: 2000001 } },
          },
        },
      },
    };

    const result = await wecomOutbound.sendText({
      cfg,
      to: "wecom-agent-upstream:default:corp-up:zhangsan",
      text: "**hello**",
    } as any);

    expect(markdownSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "zhangsan",
        text: expect.stringContaining("hello"),
      }),
    );
    expect(textSpy).not.toHaveBeenCalled();
    expect(result.messageId).toBe("up-md-cfg-1");

    textSpy.mockRestore();
    markdownSpy.mockRestore();
  });

  it("routes plain agent targets to upstream delivery when session source snapshot carries upstream corp", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./transport/agent-api/core.js");
    const client = await import("./transport/agent-api/client.js");
    const sourceRegistry = await import("./runtime/source-registry.js");
    const upstreamSpy = vi.spyOn(client, "sendUpstreamAgentApiText").mockResolvedValue(undefined);
    (api.sendText as any).mockClear();

    sourceRegistry.registerWecomSourceSnapshot({
      accountId: "default",
      source: "agent-callback",
      sessionKey: "agent:test-agent-blue:wecom:blue:direct:zhangsan",
      peerKind: "direct",
      peerId: "zhangsan",
      upstreamCorpId: "corp-up",
    });

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          agent: {
            corpId: "corp-main",
            corpSecret: "secret-main",
            agentId: 1000002,
            token: "token-main",
            encodingAESKey: "aes-main",
            upstreamCorps: {
              partner: {
                corpId: "corp-up",
                agentId: 2000001,
              },
            },
          },
        },
      },
    };

    await wecomOutbound.sendText({
      cfg,
      accountId: "default",
      sessionKey: "agent:test-agent-blue:wecom:blue:direct:zhangsan",
      to: "wecom-agent:default:user:zhangsan",
      text: "hello upstream by snapshot",
    } as any);

    expect(upstreamSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "zhangsan",
        text: "hello upstream by snapshot",
        upstreamAgent: expect.objectContaining({
          corpId: "corp-up",
          agentId: 2000001,
        }),
      }),
    );
    expect(api.sendText).not.toHaveBeenCalled();

    upstreamSpy.mockRestore();
  });

  it("routes plain agent media targets to upstream delivery when peer context carries upstream corp", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./transport/agent-api/core.js");
    const client = await import("./transport/agent-api/client.js");
    const upstreamUpload = await import("./transport/agent-api/upstream-media-upload.js");
    const contextStore = await import("./context-store.js");
    const upstreamSendSpy = vi.spyOn(client, "sendUpstreamAgentApiMedia").mockResolvedValue(undefined);
    const upstreamUploadSpy = vi
      .spyOn(upstreamUpload, "uploadUpstreamAgentApiMedia")
      .mockResolvedValue("media-up-1");
    (api.sendMedia as any).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: new Headers({ "content-type": "text/markdown" }),
      }),
    );

    contextStore.setPeerContext("default", "zhangsan", {
      peerKind: "direct",
      upstreamCorpId: "corp-up",
    });

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          agent: {
            corpId: "corp-main",
            corpSecret: "secret-main",
            agentId: 1000002,
            token: "token-main",
            encodingAESKey: "aes-main",
            upstreamCorps: {
              partner: {
                corpId: "corp-up",
                agentId: 2000001,
              },
            },
          },
        },
      },
    };

    const mediaUrl = await createTempMediaFile("file.md");

    await wecomOutbound.sendMedia({
      cfg,
      accountId: "default",
      to: "wecom-agent:default:user:zhangsan",
      text: "caption",
      mediaUrl,
    } as any);

    expect(upstreamUploadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        upstreamAgent: expect.objectContaining({
          corpId: "corp-up",
          agentId: 2000001,
        }),
        filename: "file.md",
      }),
    );
    expect(upstreamSendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "zhangsan",
        mediaId: "media-up-1",
        mediaType: "file",
        upstreamAgent: expect.objectContaining({
          corpId: "corp-up",
          agentId: 2000001,
        }),
      }),
    );
    expect(api.sendMedia).not.toHaveBeenCalled();

    upstreamSendSpy.mockRestore();
    upstreamUploadSpy.mockRestore();
  });

  it("uses account-scoped agent config in matrix mode", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const api = await import("./transport/agent-api/core.js");
    (api.sendText as any).mockResolvedValue(undefined);
    (api.sendText as any).mockClear();

    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          defaultAccount: "acct-a",
          accounts: {
            "acct-a": {
              enabled: true,
              agent: {
                corpId: "corp-a",
                corpSecret: "secret-a",
                agentId: 10001,
                token: "token-a",
                encodingAESKey: "aes-a",
              },
            },
            "acct-b": {
              enabled: true,
              agent: {
                corpId: "corp-b",
                corpSecret: "secret-b",
                agentId: 10002,
                token: "token-b",
                encodingAESKey: "aes-b",
              },
            },
          },
        },
      },
    };

    await wecomOutbound.sendText({
      cfg,
      accountId: "acct-b",
      to: "user:lisi",
      text: "hello b",
    } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "lisi",
        agent: expect.objectContaining({
          accountId: "acct-b",
          agentId: 10002,
          corpId: "corp-b",
        }),
      }),
    );
  });

  it("rejects outbound when target account has matrix conflict", async () => {
    const { wecomOutbound } = await import("./outbound.js");
    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          defaultAccount: "acct-a",
          accounts: {
            "acct-a": {
              enabled: true,
              agent: {
                corpId: "corp-shared",
                corpSecret: "secret-a",
                agentId: 10001,
                token: "token-a",
                encodingAESKey: "aes-a",
              },
            },
            "acct-b": {
              enabled: true,
              agent: {
                corpId: "corp-shared",
                corpSecret: "secret-b",
                agentId: 10001,
                token: "token-b",
                encodingAESKey: "aes-b",
              },
            },
          },
        },
      },
    };

    await expect(
      wecomOutbound.sendText({
        cfg,
        accountId: "acct-b",
        to: "user:lisi",
        text: "hello",
      } as any),
    ).rejects.toThrow(/duplicate wecom agent identity/i);
  });
});
