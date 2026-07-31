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
let upstreamAgent: never;
let primaryAgent: never;

/**
 * 覆盖 dispatchUpstreamAgentApi：各 msgtype 共用同一骨架，
 * 差异只在 body 的消息体片段与错误信息里的动作名。
 */
describe("upstream Agent API dispatch", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // 上游 token 缓存以 corpId:agentId 为键且模块级常驻，每个用例换 corpId
    // 才能确保这次 token 请求属于自己。
    corpSeq += 1;
    primaryAgent = {
      accountId: "default",
      corpId: `corp-primary-${corpSeq}`,
      corpSecret: "secret",
      agentId: 1000002,
    } as never;
    upstreamAgent = {
      accountId: "default",
      corpId: `corp-up-${corpSeq}`,
      corpSecret: "secret",
      agentId: 1000003,
    } as never;
    // 上游 token 要两跳：先取主企业 token，再换下游企业 token。
    // 所以实际发送是第 3 次 fetch（索引 2）。
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errcode: 0, access_token: "token-primary", expires_in: 7200 }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errcode: 0, access_token: "token-up", expires_in: 7200 }),
    );
  });

  /** 发送请求在 token 两跳之后。 */
  const SEND_CALL = 2;

  it("sends msgtype=text to message/send", async () => {
    const { sendUpstreamAgentApiText } = await import("./client.js");
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, msgid: "up-txt-1" }));

    const result = await sendUpstreamAgentApiText({
      upstreamAgent,
      primaryAgent,
      toUser: "zhangsan",
      text: "hi",
    });

    expect(fetchMock.mock.calls[SEND_CALL][0]).toContain("/cgi-bin/message/send");
    expect(bodyOf(SEND_CALL)).toMatchObject({
      touser: "zhangsan",
      msgtype: "text",
      agentid: 1000003,
      text: { content: "hi" },
    });
    expect(result).toMatchObject({ msgid: "up-txt-1" });
  });

  it("keeps the video media payload shape", async () => {
    const { sendUpstreamAgentApiMedia } = await import("./client.js");
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, msgid: "up-vid-1" }));

    await sendUpstreamAgentApiMedia({
      upstreamAgent,
      primaryAgent,
      toUser: "zhangsan",
      mediaId: "media-1",
      mediaType: "video",
      title: "T",
      description: "D",
    });

    expect(bodyOf(SEND_CALL)).toMatchObject({
      msgtype: "video",
      video: { media_id: "media-1", title: "T", description: "D" },
    });
  });

  it("labels errcode failures per msgtype", async () => {
    const { sendUpstreamAgentApiMedia } = await import("./client.js");
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 81013, errmsg: "no privilege" }));

    await expect(
      sendUpstreamAgentApiMedia({
        upstreamAgent,
        primaryAgent,
        toUser: "zhangsan",
        mediaId: "media-1",
        mediaType: "image",
      }),
    ).rejects.toThrow(/send image failed: 81013/);
  });

  it("keeps the unlabelled error string for text sends", async () => {
    const { sendUpstreamAgentApiText } = await import("./client.js");
    fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 81013, errmsg: "no privilege" }));

    // text 路径历史上没有动作名，保持 "send failed" 不变。
    await expect(
      sendUpstreamAgentApiText({ upstreamAgent, primaryAgent, toUser: "zhangsan", text: "hi" }),
    ).rejects.toThrow(/send failed: 81013/);
  });

  it("reports partial failures including unlicenseduser", async () => {
    const { sendUpstreamAgentApiText } = await import("./client.js");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errcode: 0, msgid: "up-1", unlicenseduser: "lisi" }),
    );

    await expect(
      sendUpstreamAgentApiText({ upstreamAgent, primaryAgent, toUser: "zhangsan", text: "hi" }),
    ).rejects.toThrow(/send partial failure: unlicenseduser=lisi/);
  });
});
