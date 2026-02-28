import { describe, expect, it } from "vitest";

import { generateAgentId } from "./dynamic-agent.js";

describe("generateAgentId account scoping", () => {
  it("generates different ids for same peer across accounts", () => {
    const a = generateAgentId("dm", "zhangsan", "acct-a");
    const b = generateAgentId("dm", "zhangsan", "acct-b");
    expect(a).toBe("wecom-acct-a-dm-zhangsan");
    expect(b).toBe("wecom-acct-b-dm-zhangsan");
    expect(a).not.toBe(b);
  });

  it("falls back to default account scope when accountId is omitted", () => {
    expect(generateAgentId("group", "wr123456")).toBe("wecom-default-group-wr123456");
  });
});
