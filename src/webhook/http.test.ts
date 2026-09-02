import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("undici", () => ({
  fetch: fetchMock,
  ProxyAgent: class ProxyAgent {
    constructor(_url: string) {}
  },
}));

import { wecomFetch } from "./http.js";

describe("Webhook HTTP boundary", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.restoreAllMocks();
  });

  it("never writes response URL or proxy credentials to failure logs", async () => {
    const failure = new TypeError("fetch failed", {
      cause: new Error("connection failed with response-secret"),
    });
    fetchMock.mockRejectedValue(failure);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      wecomFetch(
        "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=response-secret#fragment-secret",
        { method: "POST" },
        {
          proxyUrl: "http://proxy-user:proxy-secret@127.0.0.1:8080/path?token=proxy-token",
          timeoutMs: 1_000,
        },
      ),
    ).rejects.toBe(failure);

    const output = [...log.mock.calls, ...error.mock.calls].flat().join("\n");
    expect(output).toContain("https://qyapi.weixin.qq.com/cgi-bin/webhook/send");
    expect(output).toContain("http://127.0.0.1:8080");
    expect(output).not.toContain("response-secret");
    expect(output).not.toContain("fragment-secret");
    expect(output).not.toContain("proxy-user");
    expect(output).not.toContain("proxy-secret");
    expect(output).not.toContain("proxy-token");
  });
});
