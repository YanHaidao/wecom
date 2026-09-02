import { readFileSync } from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

function createApi(registrationMode: "full" | "tool-discovery" = "full") {
  const toolFactories: Array<(context: unknown) => { name: string } | null> = [];
  const api = {
    runtime: {},
    registrationMode,
    config: { tools: {} },
    logger: { warn: vi.fn() },
    registerChannel: vi.fn(),
    registerCli: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerSecurityAuditCollector: vi.fn(),
    registerTool: vi.fn((factory) => toolFactories.push(factory)),
    on: vi.fn(),
  } as unknown as OpenClawPluginApi;
  return { api, toolFactories };
}

describe("YanHaidao full WeCom plugin boundary", () => {
  it("publishes cold-path channel metadata for current OpenClaw discovery", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8"),
    ) as {
      id: string;
      channels: string[];
      channelConfigs?: Record<string, { preferOver?: string[]; schema?: { type?: string } }>;
    };

    expect(manifest.id).toBe("wecom");
    expect(manifest.channels).toEqual(["wecom"]);
    expect(manifest.channelConfigs?.wecom?.schema?.type).toBe("object");
    expect(manifest.channelConfigs?.wecom?.preferOver).toContain("wecom-openclaw-plugin");
  });

  it("owns the complete Channel while registering official and enhanced capabilities once", () => {
    const { api } = createApi();

    plugin.register(api);

    expect(plugin.id).toBe("wecom");
    expect(api.registerChannel).toHaveBeenCalledTimes(1);
    expect(api.registerCli).toHaveBeenCalledTimes(1);
    expect(api.registerHttpRoute).toHaveBeenCalledTimes(5);
    expect(api.registerSecurityAuditCollector).toHaveBeenCalledTimes(1);
    expect(api.registerTool).toHaveBeenCalledTimes(3);
    expect(api.on).not.toHaveBeenCalled();
    expect(api.registerChannel).toHaveBeenCalledWith({
      plugin: expect.objectContaining({
        agentPrompt: expect.objectContaining({ messageToolHints: expect.any(Function) }),
      }),
    });

    const registeredChannel = vi.mocked(api.registerChannel).mock.calls[0]?.[0].plugin;
    expect(registeredChannel.agentPrompt?.messageToolHints?.({} as never)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("wecom-cli"),
        expect.stringContaining("wecom_doc"),
        expect.stringContaining("MEDIA:"),
        expect.stringContaining("card_type"),
      ]),
    );
  });

  it("always exposes wecom-cli but scopes enhanced tools to WeCom sessions", () => {
    const { api, toolFactories } = createApi("tool-discovery");
    plugin.register(api);

    expect(api.registerChannel).not.toHaveBeenCalled();

    expect(toolFactories.map((factory) => factory({ messageChannel: "telegram" })?.name)).toEqual([
      "wecom-cli",
      undefined,
      undefined,
    ]);
    expect(
      toolFactories.map(
        (factory) => factory({ messageChannel: "wecom", agentAccountId: "main" })?.name,
      ),
    ).toEqual(["wecom-cli", "wecom_doc", "wecom_calendar"]);
  });
});
