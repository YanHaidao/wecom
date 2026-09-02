import { describe, expect, it } from "vitest";
import { wecomChannelConfigSchema } from "./config-schema.js";
import { normalizeCompatibilityConfig } from "./doctor-contract.js";

describe("WeCom channel config schema", () => {
  it("accepts canonical multi-account Bot config", () => {
    const result = wecomChannelConfigSchema.runtime?.safeParse({
      defaultAccount: "support",
      groupPolicy: "allowlist",
      accounts: {
        sales: {
          connectionMode: "websocket",
          botId: "sales-bot",
          secret: "sales-secret",
        },
        support: {
          connectionMode: "webhook",
          token: "support-token",
          encodingAESKey: "support-aes",
        },
      },
    });

    expect(result?.success).toBe(true);
  });

  it("requires legacy nested Bot config to pass through doctor first", () => {
    const legacyChannel = {
      accounts: {
        default: {
          bot: {
            primaryTransport: "ws",
            ws: { botId: "legacy-bot", secret: "legacy-secret" },
          },
        },
      },
    };
    expect(wecomChannelConfigSchema.runtime?.safeParse(legacyChannel).success).toBe(false);

    const migrated = normalizeCompatibilityConfig({
      cfg: { channels: { wecom: legacyChannel } } as never,
    });
    expect(
      wecomChannelConfigSchema.runtime?.safeParse(migrated.config.channels?.wecom).success,
    ).toBe(true);
  });
});
