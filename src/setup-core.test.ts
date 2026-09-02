import { describe, expect, it } from "vitest";
import { resolveWeComAccountMulti } from "./accounts.js";
import { patchWeComAccountConfig, wecomSetupAdapter } from "./setup-core.js";

describe("WeCom multi-account setup", () => {
  it("updates one named account without changing its sibling", () => {
    const cfg = {
      channels: {
        wecom: {
          defaultAccount: "support",
          accounts: {
            sales: { botId: "sales-bot", secret: "sales-secret" },
            support: { botId: "old-support-bot", secret: "old-support-secret" },
          },
        },
      },
    } as never;

    const next = patchWeComAccountConfig({
      cfg,
      accountId: "support",
      patch: {
        connectionMode: "websocket",
        botId: "new-support-bot",
        secret: "new-support-secret",
      },
    });

    expect(resolveWeComAccountMulti({ cfg: next, accountId: "sales" })).toMatchObject({
      botId: "sales-bot",
      secret: "sales-secret",
    });
    expect(resolveWeComAccountMulti({ cfg: next, accountId: "support" })).toMatchObject({
      botId: "new-support-bot",
      secret: "new-support-secret",
    });
  });

  it("stores an added named account under accounts without moving root Bot credentials", () => {
    const cfg = {
      channels: {
        wecom: {
          connectionMode: "websocket",
          botId: "root-bot",
          secret: "root-secret",
        },
      },
    } as never;

    const next = wecomSetupAdapter.applyAccountConfig({
      cfg,
      accountId: "sales",
      input: {
        connectionMode: "websocket",
        botId: "sales-bot",
        secret: "sales-secret",
      },
    });

    expect(next.channels?.wecom).toMatchObject({
      botId: "root-bot",
      secret: "root-secret",
      accounts: {
        sales: {
          enabled: true,
          botId: "sales-bot",
          secret: "sales-secret",
        },
      },
    });
    expect(resolveWeComAccountMulti({ cfg: next, accountId: "default" })).toMatchObject({
      botId: "root-bot",
      secret: "root-secret",
    });
  });

  it("validates credentials for the explicitly selected Bot transport", () => {
    const emptyCfg = { channels: { wecom: {} } } as never;
    expect(
      wecomSetupAdapter.validateInput?.({
        cfg: emptyCfg,
        accountId: "default",
        input: { connectionMode: "websocket", botId: "bot-only" },
      }),
    ).toContain("--bot-id and --secret");
    expect(
      wecomSetupAdapter.validateInput?.({
        cfg: emptyCfg,
        accountId: "default",
        input: { connectionMode: "webhook", token: "token-only" },
      }),
    ).toContain("--token and --encoding-aes-key");
  });
});
