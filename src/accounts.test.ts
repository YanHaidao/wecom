import { describe, expect, it } from "vitest";
import {
  listWeComAccountIds,
  listEnabledWeComAccounts,
  resolveDefaultWeComAccountId,
  resolveWeComAccountMulti,
  resolveWeComConfigDiagnostics,
} from "./accounts.js";

describe("WeCom account resolution", () => {
  it("resolves the official flat Bot fields from the selected account", () => {
    const cfg = {
      channels: {
        wecom: {
          botId: "different-root-bot",
          secret: "different-root-secret",
          defaultAccount: "default",
          accounts: {
            default: {
              connectionMode: "websocket",
              botId: "account-bot",
              secret: "account-secret",
              dmPolicy: "open",
              allowFrom: ["*"],
              agent: {
                corpId: "ww-account",
                corpSecret: "agent-secret",
                agentId: 1001,
                token: "callback-token",
                encodingAESKey: "callback-aes",
                dmPolicy: "allowlist",
                allowFrom: ["alice"],
              },
            },
          },
        },
      },
    } as never;

    const account = resolveWeComAccountMulti({ cfg, accountId: "default" });
    expect(account).toMatchObject({
      botId: "account-bot",
      secret: "account-secret",
      config: { connectionMode: "websocket", dmPolicy: "open", allowFrom: ["*"] },
      agent: {
        corpId: "ww-account",
        corpSecret: "agent-secret",
        config: { dmPolicy: "allowlist", allowFrom: ["alice"] },
      },
    });
    expect(resolveWeComConfigDiagnostics({ cfg, accountId: "default" })).toEqual({
      botIdSource: "accounts.default.botId",
      secretSource: "accounts.default.secret",
      agentSecretSource: "accounts.default.agent.corpSecret",
      compatibilityFields: [],
    });
  });

  it("does not inherit root credentials into named accounts", () => {
    const cfg = {
      channels: {
        wecom: {
          botId: "root-bot",
          secret: "root-secret",
          agent: {
            corpId: "root-corp",
            corpSecret: "root-agent-secret",
            token: "root-token",
            encodingAESKey: "root-aes",
          },
          accounts: {
            sales: { name: "Sales", dmPolicy: "pairing" },
          },
        },
      },
    } as never;

    expect(resolveWeComAccountMulti({ cfg, accountId: "sales" })).toMatchObject({
      botId: "",
      secret: "",
      agent: undefined,
      config: { dmPolicy: "pairing", botId: undefined, secret: undefined },
    });
  });

  it("keeps two Bot accounts isolated and routes omitted accountId to defaultAccount", () => {
    const cfg = {
      channels: {
        wecom: {
          defaultAccount: "support",
          dmPolicy: "pairing",
          accounts: {
            sales: {
              connectionMode: "websocket",
              botId: "sales-bot",
              secret: "sales-secret",
            },
            support: {
              connectionMode: "websocket",
              botId: "support-bot",
              secret: "support-secret",
            },
          },
        },
      },
    } as never;

    expect(listWeComAccountIds(cfg)).toEqual(["sales", "support"]);
    expect(resolveDefaultWeComAccountId(cfg)).toBe("support");
    expect(resolveWeComAccountMulti({ cfg })).toMatchObject({
      accountId: "support",
      botId: "support-bot",
      secret: "support-secret",
      config: { dmPolicy: "pairing" },
    });
    expect(resolveWeComAccountMulti({ cfg, accountId: "sales" })).toMatchObject({
      accountId: "sales",
      botId: "sales-bot",
      secret: "sales-secret",
    });
  });

  it("includes webhook-only accounts in the enabled account set", () => {
    const cfg = {
      channels: {
        wecom: {
          accounts: {
            callback: {
              connectionMode: "webhook",
              token: "callback-token",
              encodingAESKey: "callback-aes",
            },
          },
        },
      },
    } as never;

    expect(listEnabledWeComAccounts(cfg).map((account) => account.accountId)).toEqual([
      "callback",
    ]);
  });
});
