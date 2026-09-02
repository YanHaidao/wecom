import { describe, expect, it } from "vitest";
import { resolveBoundWecomAccountId } from "./tool-context.js";

const config = {
  channels: {
    wecom: {
      defaultAccount: "corp-a",
      accounts: {
        "corp-a": { agent: {} },
        "corp-b": { agent: {} },
      },
    },
  },
} as never;

describe("WeCom enhanced tool account binding", () => {
  it("uses the account selected by the official wecom Channel", () => {
    expect(
      resolveBoundWecomAccountId({
        cfg: config,
        toolContext: { messageChannel: "wecom", agentAccountId: "corp-b" },
      }),
    ).toBe("corp-b");
  });

  it("rejects a requested account that differs from the Channel context", () => {
    expect(() =>
      resolveBoundWecomAccountId({
        cfg: config,
        requestedAccountId: "corp-a",
        toolContext: { messageChannel: "wecom", agentAccountId: "corp-b" },
      }),
    ).toThrow(/拒绝跨账号调用/);
  });

  it("fails closed when a multi-account session loses its account context", () => {
    expect(() => resolveBoundWecomAccountId({ cfg: config })).toThrow(/多账号模式/);
  });
});
