import { describe, expect, it } from "vitest";
import {
  listWecomAddonAccountIds,
  resolveAddonAgentAccount,
  resolveDefaultWecomAddonAccountId,
} from "./agent-account.js";

describe("WeCom enhanced Agent account resolver", () => {
  it("reads the official corpSecret shape", () => {
    const cfg = {
      channels: {
        wecom: {
          agent: { corpId: "ww-main", corpSecret: "secret", agentId: "1001" },
          network: { egressProxyUrl: " http://proxy.internal:3128 " },
        },
      },
    } as never;

    expect(resolveAddonAgentAccount(cfg, "default")).toMatchObject({
      accountId: "default",
      configured: true,
      corpId: "ww-main",
      corpSecret: "secret",
      agentId: 1001,
      network: { egressProxyUrl: "http://proxy.internal:3128" },
    });
  });

  it("keeps legacy agentSecret compatibility during migration", () => {
    const cfg = {
      channels: {
        wecom: { agent: { corpId: "ww-main", agentSecret: "legacy", agentId: 1002 } },
      },
    } as never;

    expect(resolveAddonAgentAccount(cfg, "default")?.corpSecret).toBe("legacy");
  });

  it("normalizes official multi-account ids and honors defaultAccount", () => {
    const cfg = {
      channels: {
        wecom: {
          defaultAccount: " Sales ",
          accounts: {
            Primary: { agent: { corpId: "ww-primary", corpSecret: "a", agentId: 1 } },
            Sales: { agent: { corpId: "ww-sales", corpSecret: "b", agentId: 2 } },
          },
        },
      },
    } as never;

    expect(listWecomAddonAccountIds(cfg)).toEqual(["primary", "sales"]);
    expect(resolveDefaultWecomAddonAccountId(cfg)).toBe("sales");
    expect(resolveAddonAgentAccount(cfg, "SALES")?.corpId).toBe("ww-sales");
  });

  it("fails configuration readiness when Agent API identity is incomplete", () => {
    const cfg = {
      channels: { wecom: { agent: { corpId: "ww-main", corpSecret: "secret" } } },
    } as never;

    expect(resolveAddonAgentAccount(cfg, "default")?.configured).toBe(false);
  });
});
