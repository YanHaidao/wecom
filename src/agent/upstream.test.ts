import { describe, expect, it } from "vitest";
import type { ResolvedAgentAccount } from "../types/index.js";
import {
  buildUpstreamAgentTarget,
  parseUpstreamAgentTarget,
  resolveInboundAgentIdentity,
  resolveOutboundUpstreamTarget,
} from "./upstream.js";

function makeAgent(): ResolvedAgentAccount {
  return {
    accountId: "sales",
    enabled: true,
    configured: true,
    corpId: "PRIMARY",
    corpSecret: "secret",
    agentId: 100,
    token: "token",
    encodingAESKey: "key",
    config: {
      corpId: "PRIMARY",
      corpSecret: "secret",
      agentId: 100,
      token: "token",
      encodingAESKey: "key",
      upstreamCorps: {
        downstream: { corpId: "DOWNSTREAM", agentId: "200" },
      },
    },
  };
}

describe("WeCom upstream identity", () => {
  it("keeps the primary enterprise on the primary path", () => {
    expect(
      resolveInboundAgentIdentity({ agent: makeAgent(), messageToUserName: "primary" }),
    ).toEqual({ kind: "primary" });
  });

  it("binds a downstream callback to its configured corp and agent", () => {
    expect(
      resolveInboundAgentIdentity({ agent: makeAgent(), messageToUserName: "downstream" }),
    ).toEqual({
      kind: "upstream",
      upstream: { configKey: "downstream", corpId: "DOWNSTREAM", agentId: 200 },
    });
  });

  it("fails closed for missing, ambiguous, or invalid downstream mappings", () => {
    const agent = makeAgent();
    expect(resolveInboundAgentIdentity({ agent, messageToUserName: "unknown" }).kind).toBe(
      "reject",
    );

    agent.config.upstreamCorps = {
      a: { corpId: "duplicate", agentId: 1 },
      b: { corpId: "DUPLICATE", agentId: 2 },
    };
    expect(resolveInboundAgentIdentity({ agent, messageToUserName: "duplicate" }).kind).toBe(
      "reject",
    );

    agent.config.upstreamCorps = { bad: { corpId: "bad", agentId: 0 } };
    expect(resolveInboundAgentIdentity({ agent, messageToUserName: "bad" }).kind).toBe("reject");
  });

  it("round-trips the account-scoped upstream reply target", () => {
    const target = buildUpstreamAgentTarget({
      accountId: "Sales:East",
      corpId: "corp:downstream",
      userId: "user:42",
    });
    expect(parseUpstreamAgentTarget(target)).toEqual({
      accountId: "Sales:East",
      corpId: "corp:downstream",
      userId: "user:42",
    });
    expect(parseUpstreamAgentTarget(`wecom:${target}`)).toEqual({
      accountId: "Sales:East",
      corpId: "corp:downstream",
      userId: "user:42",
    });
  });

  it("rejects cross-account outbound reuse", () => {
    const agent = makeAgent();
    const target = buildUpstreamAgentTarget({
      accountId: "other",
      corpId: "DOWNSTREAM",
      userId: "alice",
    });
    expect(() => resolveOutboundUpstreamTarget({ agent, target })).toThrow(/cannot be sent/);
  });
});
