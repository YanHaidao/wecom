import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("../../http.js", () => ({
  wecomFetch: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock("../../config/index.js", () => ({
  resolveWecomEgressProxyUrlFromNetwork: () => undefined,
}));

function jsonResponse(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** Reads the JSON body of the Nth wecomFetch call. */
function bodyOf(callIndex: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[callIndex]?.[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? "{}");
}

let corpSeq = 0;
let agent: never;

describe("Agent API markdown", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // The access-token cache is keyed by corpId:agentId and lives for the whole
    // module, so give each test a fresh corpId to force a token fetch it owns.
    corpSeq += 1;
    agent = {
      accountId: "default",
      corpId: `corp-md-${corpSeq}`,
      corpSecret: "secret",
      agentId: 1000002,
    } as never;
    // First call in each test is the access-token fetch.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errcode: 0, access_token: "token-1", expires_in: 7200 }),
    );
  });

  it("sends msgtype=markdown to message/send for user targets", async () => {
    const { sendMarkdown } = await import("./core.js");
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, msgid: "md-1" }));

    const result = await sendMarkdown({ agent, toUser: "zhangsan", text: "# hi" });

    expect(fetchMock.mock.calls[1][0]).toContain("/cgi-bin/message/send");
    expect(bodyOf(1)).toMatchObject({
      touser: "zhangsan",
      msgtype: "markdown",
      markdown: { content: "# hi" },
    });
    expect(result).toMatchObject({ msgid: "md-1" });
  });

  it("still reports errcode failures for markdown sends", async () => {
    const { sendMarkdown } = await import("./core.js");
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 81013, errmsg: "no privilege" }));

    await expect(sendMarkdown({ agent, toUser: "zhangsan", text: "# hi" })).rejects.toThrow(
      /send markdown failed: 81013/,
    );
  });

  // Dropping chatId silently used to leave the body with no recipient field at
  // all (no touser/toparty/totag/chatid), which WeCom rejects. A chat target
  // that sendText can deliver must fail loudly here, not produce a bad request.
  it("rejects chat targets instead of sending a recipient-less request", async () => {
    const { sendMarkdown } = await import("./core.js");

    await expect(sendMarkdown({ agent, chatId: "wrCHAT", text: "# hi" })).rejects.toThrow(
      /不支持群会话.*wrCHAT/s,
    );
    // Rejected before any send; only the beforeEach token mock is unconsumed.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects chat targets on the upstream path too", async () => {
    const { sendUpstreamAgentApiMarkdown } = await import("./client.js");

    await expect(
      sendUpstreamAgentApiMarkdown({
        upstreamAgent: agent,
        primaryAgent: agent,
        chatId: "wrCHAT",
        text: "# hi",
      }),
    ).rejects.toThrow(/不支持群会话.*wrCHAT/s);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
