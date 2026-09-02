import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setWeComRuntime, getRuntime: getWeComRuntime } = createPluginRuntimeStore<PluginRuntime>("WeCom runtime not initialized");

export { setWeComRuntime, getWeComRuntime };
