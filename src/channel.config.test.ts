import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { describe, expect, it } from "vitest";

import { wecomPlugin } from "./channel.js";

describe("wecomPlugin config.deleteAccount", () => {
  it("removes only the target matrix account", () => {
    const cfg: OpenClawConfig = {
      channels: {
        wecom: {
          enabled: true,
          accounts: {
            "acct-a": {
              enabled: true,
              bot: {
                token: "token-a",
                encodingAESKey: "aes-a",
              },
            },
            "acct-b": {
              enabled: true,
              bot: {
                token: "token-b",
                encodingAESKey: "aes-b",
              },
            },
          },
        },
      },
    } as OpenClawConfig;

    const next = wecomPlugin.config.deleteAccount!({ cfg, accountId: "acct-a" });
    const accounts = (next.channels?.wecom as { accounts?: Record<string, unknown> } | undefined)
      ?.accounts;

    expect(accounts?.["acct-a"]).toBeUndefined();
    expect(accounts?.["acct-b"]).toBeDefined();
    expect(next.channels?.wecom).toBeDefined();
  });

  it("removes legacy wecom section when deleting default account", () => {
    const cfg: OpenClawConfig = {
      channels: {
        wecom: {
          enabled: true,
          bot: {
            token: "token",
            encodingAESKey: "aes",
          },
        },
      },
    } as OpenClawConfig;

    const next = wecomPlugin.config.deleteAccount!({ cfg, accountId: "default" });
    expect(next.channels?.wecom).toBeUndefined();
  });
});

describe("wecomPlugin account conflict guards", () => {
  it("marks duplicate bot token account as unconfigured", async () => {
    const cfg: OpenClawConfig = {
      channels: {
        wecom: {
          enabled: true,
          accounts: {
            "acct-a": {
              enabled: true,
              bot: { token: "token-shared", encodingAESKey: "aes-a" },
            },
            "acct-b": {
              enabled: true,
              bot: { token: "token-shared", encodingAESKey: "aes-b" },
            },
          },
        },
      },
    } as OpenClawConfig;

    const accountA = wecomPlugin.config.resolveAccount(cfg, "acct-a");
    const accountB = wecomPlugin.config.resolveAccount(cfg, "acct-b");
    expect(await wecomPlugin.config.isConfigured!(accountA, cfg)).toBe(true);
    expect(await wecomPlugin.config.isConfigured!(accountB, cfg)).toBe(false);
    expect(wecomPlugin.config.unconfiguredReason?.(accountB, cfg)).toContain("Duplicate WeCom bot token");
  });

  it("marks duplicate bot aibotid account as unconfigured", async () => {
    const cfg: OpenClawConfig = {
      channels: {
        wecom: {
          enabled: true,
          accounts: {
            "acct-a": {
              enabled: true,
              bot: { token: "token-a", encodingAESKey: "aes-a", aibotid: "BOT_001" },
            },
            "acct-b": {
              enabled: true,
              bot: { token: "token-b", encodingAESKey: "aes-b", aibotid: "BOT_001" },
            },
          },
        },
      },
    } as OpenClawConfig;

    const accountB = wecomPlugin.config.resolveAccount(cfg, "acct-b");
    expect(await wecomPlugin.config.isConfigured!(accountB, cfg)).toBe(false);
    expect(wecomPlugin.config.unconfiguredReason?.(accountB, cfg)).toContain("Duplicate WeCom bot aibotid");
  });

  it("marks duplicate corpId/agentId account as unconfigured", async () => {
    const cfg: OpenClawConfig = {
      channels: {
        wecom: {
          enabled: true,
          accounts: {
            "acct-a": {
              enabled: true,
              agent: {
                corpId: "corp-1",
                corpSecret: "secret-a",
                agentId: 1001,
                token: "token-a",
                encodingAESKey: "aes-a",
              },
            },
            "acct-b": {
              enabled: true,
              agent: {
                corpId: "corp-1",
                corpSecret: "secret-b",
                agentId: 1001,
                token: "token-b",
                encodingAESKey: "aes-b",
              },
            },
          },
        },
      },
    } as OpenClawConfig;

    const accountB = wecomPlugin.config.resolveAccount(cfg, "acct-b");
    expect(await wecomPlugin.config.isConfigured!(accountB, cfg)).toBe(false);
    expect(wecomPlugin.config.unconfiguredReason?.(accountB, cfg)).toContain(
      "Duplicate WeCom agent identity",
    );
  });
});
