import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAgentAccount } from "../types/index.js";
import { getAccessToken, getUpstreamAccessToken, sendUpstreamText } from "./api-client.js";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../http.js", () => ({
  wecomFetch: fetchMock,
  readResponseBodyAsBuffer: vi.fn(),
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("WeCom upstream Agent API", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("exchanges the primary token and sends with the downstream agent id", async () => {
    const primaryAgent: ResolvedAgentAccount = {
      accountId: "account-api-test",
      enabled: true,
      configured: true,
      corpId: "primary-api-test",
      corpSecret: "secret",
      agentId: 100,
      token: "token",
      encodingAESKey: "key",
      config: {
        corpId: "primary-api-test",
        corpSecret: "secret",
        agentId: 100,
        token: "token",
        encodingAESKey: "key",
      },
    };
    const upstream = { configKey: "downstream", corpId: "downstream-api-test", agentId: 200 };

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "primary-token", expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "downstream-token", expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: "ok" }));

    await expect(getUpstreamAccessToken({ primaryAgent, upstream })).resolves.toBe(
      "downstream-token",
    );
    await sendUpstreamText({
      primaryAgent,
      upstream,
      toUser: "alice",
      text: "hello",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("corpgroup/corp/gettoken");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      corpid: "downstream-api-test",
      business_type: 1,
      agentid: 200,
    });
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("access_token=downstream-token");
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      touser: "alice",
      agentid: 200,
      msgtype: "text",
    });
  });

  it("keeps primary access-token caches isolated by OpenClaw account", async () => {
    const createPrimaryAgent = (accountId: string, corpSecret: string): ResolvedAgentAccount => ({
      accountId,
      enabled: true,
      configured: true,
      corpId: "shared-primary-cache-test",
      corpSecret,
      agentId: 301,
      token: "token",
      encodingAESKey: "key",
      config: {
        corpId: "shared-primary-cache-test",
        corpSecret,
        agentId: 301,
        token: "token",
        encodingAESKey: "key",
      },
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "sales-token", expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "support-token", expires_in: 7200 }));

    await expect(getAccessToken(createPrimaryAgent("sales-cache-test", "sales-secret"))).resolves.toBe(
      "sales-token",
    );
    await expect(
      getAccessToken(createPrimaryAgent("support-cache-test", "support-secret")),
    ).resolves.toBe("support-token");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps downstream token exchanges isolated by OpenClaw account", async () => {
    const createPrimaryAgent = (accountId: string): ResolvedAgentAccount => ({
      accountId,
      enabled: true,
      configured: true,
      corpId: "shared-upstream-primary-cache-test",
      corpSecret: `${accountId}-secret`,
      agentId: 401,
      token: "token",
      encodingAESKey: "key",
      config: {
        corpId: "shared-upstream-primary-cache-test",
        corpSecret: `${accountId}-secret`,
        agentId: 401,
        token: "token",
        encodingAESKey: "key",
      },
    });
    const upstream = {
      configKey: "shared-downstream",
      corpId: "shared-downstream-cache-test",
      agentId: 402,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "sales-primary", expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "sales-downstream", expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "support-primary", expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "support-downstream", expires_in: 7200 }));

    await expect(
      getUpstreamAccessToken({ primaryAgent: createPrimaryAgent("sales-upstream-cache-test"), upstream }),
    ).resolves.toBe("sales-downstream");
    await expect(
      getUpstreamAccessToken({
        primaryAgent: createPrimaryAgent("support-upstream-cache-test"),
        upstream,
      }),
    ).resolves.toBe("support-downstream");

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
