import { describe, expect, it } from "vitest";
import { normalizeCompatibilityConfig } from "./doctor-contract.js";

describe("WeCom config doctor", () => {
  it("migrates the previous multi-account Bot and Agent shape", () => {
    const cfg = {
      channels: {
        wecom: {
          defaultAccount: "default",
          accounts: {
            default: {
              bot: {
                primaryTransport: "ws",
                ws: { botId: "legacy-bot", secret: "legacy-secret" },
                dm: { policy: "open", allowFrom: ["*"] },
              },
              agent: {
                corpId: "ww-corp",
                agentSecret: "legacy-agent-secret",
                agentId: 1001,
                token: "callback-token",
                encodingAESKey: "callback-aes",
                dm: { policy: "allowlist", allowFrom: ["alice"] },
              },
            },
          },
        },
      },
    } as never;

    const result = normalizeCompatibilityConfig({ cfg });
    expect(result.config.channels?.wecom).toEqual({
      defaultAccount: "default",
      accounts: {
        default: {
          connectionMode: "websocket",
          botId: "legacy-bot",
          secret: "legacy-secret",
          dmPolicy: "open",
          allowFrom: ["*"],
          agent: {
            corpId: "ww-corp",
            corpSecret: "legacy-agent-secret",
            agentId: 1001,
            token: "callback-token",
            encodingAESKey: "callback-aes",
            dmPolicy: "allowlist",
            allowFrom: ["alice"],
          },
        },
      },
    });
    expect(result.changes).toHaveLength(2);
  });

  it("keeps canonical values when both canonical and legacy fields exist", () => {
    const cfg = {
      channels: {
        wecom: {
          botId: "canonical-bot",
          secret: "canonical-secret",
          bot: { ws: { botId: "legacy-bot", secret: "legacy-secret" } },
        },
      },
    } as never;

    const result = normalizeCompatibilityConfig({ cfg });
    expect(result.config.channels?.wecom).toEqual({
      botId: "canonical-bot",
      secret: "canonical-secret",
    });
  });

  it("is idempotent", () => {
    const cfg = {
      channels: {
        wecom: {
          accounts: {
            default: { bot: { primaryTransport: "webhook", token: "token" } },
          },
        },
      },
    } as never;

    const first = normalizeCompatibilityConfig({ cfg });
    expect(normalizeCompatibilityConfig({ cfg: first.config })).toEqual({
      config: first.config,
      changes: [],
    });
  });
});
