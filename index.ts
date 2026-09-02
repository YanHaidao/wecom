/**
 * YanHaidao full-featured WeCom plugin.
 *
 * The channel/runtime baseline tracks WecomTeam/wecom-openclaw-plugin while
 * tenant isolation, diagnostics, and advanced business APIs remain owned here.
 */
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/core";
import { registerWecomDiagnosticsCli } from "./src/addon/cli.js";
import { collectWecomAuditFindings } from "./src/addon/security-audit.js";
import { createWeComCliTool, CLI_TOOL_NAME } from "./src/cli/index.js";
import {
  LEGACY_TOOL_WARNING,
  shouldWarnLegacyToolAllow,
} from "./src/cli/legacy-tool-warning.js";
import { WEBHOOK_PATHS } from "./src/const.js";
import { registerWecomCalendarTool } from "./src/capability/calendar/tool.js";
import { registerWecomDocTool } from "./src/capability/doc/tool.js";
import { createWecomAgentWebhookHandler } from "./src/agent/webhook.js";
import { wecomPlugin } from "./src/channel.js";
import { setWeComRuntime } from "./src/runtime.js";
import { handleWecomWebhookRequest } from "./src/webhook/index.js";

function registerFull(api: OpenClawPluginApi) {
    if (shouldWarnLegacyToolAllow(api.config.tools)) {
      api.logger.warn(LEGACY_TOOL_WARNING);
    }

    api.registerTool(
      (ctx: OpenClawPluginToolContext) => createWeComCliTool({ accountId: ctx.agentAccountId }),
      { name: CLI_TOOL_NAME },
    );
    registerWecomDocTool(api);
    registerWecomCalendarTool(api);
    const agentWebhookHandler = createWecomAgentWebhookHandler(api.runtime);
    api.registerHttpRoute({
      path: WEBHOOK_PATHS.AGENT_PLUGIN,
      handler: agentWebhookHandler,
      auth: "plugin",
      match: "prefix",
    });
    api.registerHttpRoute({
      path: WEBHOOK_PATHS.AGENT,
      handler: agentWebhookHandler,
      auth: "plugin",
      match: "prefix",
    });

    for (const routePath of [
      WEBHOOK_PATHS.BOT_PLUGIN,
      WEBHOOK_PATHS.BOT_ALT,
      WEBHOOK_PATHS.BOT,
    ]) {
      api.registerHttpRoute({
        path: routePath,
        handler: handleWecomWebhookRequest,
        auth: "plugin",
        match: "prefix",
      });
    }
}

const plugin: OpenClawPluginDefinition = defineChannelPluginEntry({
  id: "wecom",
  name: "企业微信（YanHaidao 全功能版）",
  description: "融合腾讯官方 Channel、wecom-cli 与企业增强能力的完整企业微信插件",
  plugin: wecomPlugin,
  configSchema: () => wecomPlugin.configSchema!,
  setRuntime: setWeComRuntime,
  registerCliMetadata: registerWecomDiagnosticsCli,
  registerFull,
  registerCapabilities: (api) => {
    api.registerSecurityAuditCollector(collectWecomAuditFindings);
  },
});

export default plugin;
