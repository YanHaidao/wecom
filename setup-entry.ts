import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { wecomSetupPlugin } from "./src/channel.setup.js";

export default defineSetupPluginEntry(wecomSetupPlugin);
