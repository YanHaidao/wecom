import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { ResolvedWeComAccount } from "./utils.js";
import { wecomConfigAdapter } from "./config-adapter.js";
import { wecomChannelConfigSchema } from "./config-schema.js";
import { CHANNEL_ID } from "./const.js";
import { wecomSetupWizard } from "./onboarding.js";
import { wecomSetupContract } from "./setup-core.js";

export const wecomSetupPlugin: ChannelPlugin<ResolvedWeComAccount> = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "企业微信",
    selectionLabel: "企业微信 (WeCom)",
    detailLabel: "企业微信智能机器人",
    docsPath: `/channels/${CHANNEL_ID}`,
    docsLabel: CHANNEL_ID,
    blurb: "企业微信智能机器人接入插件",
    systemImage: "message.fill",
    quickstartAllowFrom: true,
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  configSchema: wecomChannelConfigSchema,
  config: wecomConfigAdapter,
  setupContract: wecomSetupContract,
  setupWizard: wecomSetupWizard,
};
