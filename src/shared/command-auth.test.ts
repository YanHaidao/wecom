import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
import { describe, expect, it, vi } from "vitest";

import {
  buildWecomUnauthorizedCommandPrompt,
  resolveWecomCommandAuthorization,
} from "./command-auth.js";

function createRuntime(storeAllowFrom: string[]) {
  const readAllowFromStore = vi.fn(async () => storeAllowFrom);
  const runtime = {
    channel: {
      commands: {
        shouldComputeCommandAuthorized: vi.fn(() => true),
        resolveCommandAuthorizedFromAuthorizers: vi.fn(
          ({ authorizers }: { authorizers: Array<{ configured: boolean; allowed: boolean }> }) =>
            authorizers.some((entry) => entry.configured && entry.allowed),
        ),
      },
      pairing: { readAllowFromStore },
    },
  } as unknown as PluginRuntime;
  return { runtime, readAllowFromStore };
}

const cfg = {} as OpenClawConfig;

describe("WeCom command authorization", () => {
  it("authorizes a paired direct-message sender in the matching account", async () => {
    const { runtime, readAllowFromStore } = createRuntime(["user:Alice"]);

    const result = await resolveWecomCommandAuthorization({
      core: runtime,
      cfg,
      accountId: "sales",
      accountConfig: { dmPolicy: "pairing", allowFrom: [] },
      rawBody: "/status",
      senderUserId: "alice",
      isGroup: false,
    });

    expect(readAllowFromStore).toHaveBeenCalledWith({ channel: "wecom", accountId: "sales" });
    expect(result.effectiveAllowFrom).toEqual(["user:Alice"]);
    expect(result.senderAllowed).toBe(true);
    expect(result.commandAuthorized).toBe(true);
  });

  it("does not use DM pairing approvals for allowlist policy or group commands", async () => {
    const allowlistRuntime = createRuntime(["alice"]);
    const groupRuntime = createRuntime(["alice"]);

    const allowlist = await resolveWecomCommandAuthorization({
      core: allowlistRuntime.runtime,
      cfg,
      accountId: "sales",
      accountConfig: { dmPolicy: "allowlist", allowFrom: ["bob"] },
      rawBody: "/status",
      senderUserId: "alice",
      isGroup: false,
    });
    const group = await resolveWecomCommandAuthorization({
      core: groupRuntime.runtime,
      cfg,
      accountId: "sales",
      accountConfig: { dmPolicy: "pairing", allowFrom: ["bob"] },
      rawBody: "/status",
      senderUserId: "alice",
      isGroup: true,
    });

    expect(allowlistRuntime.readAllowFromStore).not.toHaveBeenCalled();
    expect(groupRuntime.readAllowFromStore).not.toHaveBeenCalled();
    expect(allowlist.commandAuthorized).toBe(false);
    expect(group.commandAuthorized).toBe(false);
  });

  it("points authorization guidance at the real single- and multi-account config paths", () => {
    const singleBot = buildWecomUnauthorizedCommandPrompt({
      senderUserId: "alice",
      dmPolicy: "allowlist",
      scope: "bot",
      accountId: "default",
      multiAccount: false,
    });
    const multiAgent = buildWecomUnauthorizedCommandPrompt({
      senderUserId: "alice",
      dmPolicy: "disabled",
      scope: "agent",
      accountId: "sales",
      multiAccount: true,
    });

    expect(singleBot).toContain("channels.wecom.dmPolicy");
    expect(singleBot).not.toContain("channels.wecom.bot.dmPolicy");
    expect(multiAgent).toContain("channels.wecom.accounts.sales.agent.dmPolicy");
  });
});
