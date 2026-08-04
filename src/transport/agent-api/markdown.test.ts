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

  // 手册 90248（应用推送消息）有 markdown 消息章节：chatid + msgtype:markdown。
  // 群会话不需要降级成纯文本。
  it("sends msgtype=markdown to appchat/send for chat targets", async () => {
    const { sendMarkdown } = await import("./core.js");
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0 }));

    await sendMarkdown({ agent, chatId: "wrCHAT", text: "# hi" });

    expect(fetchMock.mock.calls[1][0]).toContain("/cgi-bin/appchat/send");
    expect(bodyOf(1)).toMatchObject({
      chatid: "wrCHAT",
      msgtype: "markdown",
      markdown: { content: "# hi" },
    });
    // appchat/send 不带 agentid。
    expect(bodyOf(1)).not.toHaveProperty("agentid");
  });

  it("sends msgtype=markdown to appchat/send on the upstream path too", async () => {
    const { sendUpstreamAgentApiMarkdown } = await import("./client.js");
    // 上游 token 要两跳：beforeEach 的那次是主企业 token，这里补下游企业 token。
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errcode: 0, access_token: "token-up", expires_in: 7200 }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0 }));

    await sendUpstreamAgentApiMarkdown({
      upstreamAgent: agent,
      primaryAgent: agent,
      chatId: "wrCHAT",
      text: "# hi",
    });

    const lastCall = fetchMock.mock.calls.at(-1)!;
    expect(lastCall[0]).toContain("/cgi-bin/appchat/send");
    expect(JSON.parse((lastCall[1] as { body: string }).body)).toMatchObject({
      chatid: "wrCHAT",
      msgtype: "markdown",
      markdown: { content: "# hi" },
    });
  });
});
