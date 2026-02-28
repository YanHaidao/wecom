import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { describe, expect, it } from "vitest";

import { resolveWecomAccount } from "./accounts.js";

describe("resolveWecomAccount", () => {
  const cfg: OpenClawConfig = {
    channels: {
      wecom: {
        enabled: true,
        defaultAccount: "acct-a",
        accounts: {
          "acct-a": {
            enabled: true,
            bot: {
              token: "token-a",
              encodingAESKey: "aes-a",
            },
          },
        },
      },
    },
  } as OpenClawConfig;

  it("does not fall back when explicit accountId does not exist", () => {
    const account = resolveWecomAccount({ cfg, accountId: "missing" });
    expect(account.accountId).toBe("missing");
    expect(account.enabled).toBe(false);
    expect(account.configured).toBe(false);
  });

  it("uses configured default account when accountId is omitted", () => {
    const account = resolveWecomAccount({ cfg });
    expect(account.accountId).toBe("acct-a");
    expect(account.enabled).toBe(true);
    expect(account.configured).toBe(true);
  });
});
