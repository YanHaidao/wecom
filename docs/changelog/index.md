---
layout: default
title: 更新日志
nav_order: 99
---

# 更新日志

这里记录 WeCom 插件及其帮助文档的历次变更。

---

## v2.4.12（2026-04-12）

- **新增优化** — 自建应用菜单事件可路由到本地脚本。企业微信自建应用收到 `click` 等事件后，可按 `eventType`、`eventKey`、`changeType` 命中本地 `Node.js` / `Python` 脚本，不再只能一律进入默认 Agent 流程。
- **新增优化** — 脚本既能直接回复，也能继续链到 Agent。适合"菜单先走固定逻辑，复杂问题再交给 Agent"的模式。
- **新增能力** — 上下游企业现在可通过 Agent 渠道互通。根据下游 `CorpID` 和 `agent.upstreamCorps` 把回复准确发回对应企业，图片和语音等媒体链路一并补稳。
- **重要修复** — Webhook 入站文件不再被固定 5MB 限制误拦，改按当前 WeCom 配置解析后的大小限制执行。

## v2.3.27（2026-03-27）

- **重要修复** — `channel add` 重新支持 WeCom guided setup，`openclaw channels add` 可正常识别并进入配置流程。
- **重要修复** — 修复 `installedCatalogById is not defined`，渠道添加流程恢复稳定。
- **升级兼容** — 清理 OpenClaw 新版下失效的 SDK 旧入口，覆盖工具上下文、outbound 适配器和 Bot WS 媒体发送链路。

## v2.3.26（2026-03-26）

- **重要修复** — 升级 OpenClaw 后不再出现 `is not a function` 一类启动/运行错误。
- **回复更稳** — Agent 和 Bot WS 不再乱串，谁收到消息由谁来回复。
- **体验修复** — Bot WS 发图后不再多冒一条 `Done...`，收尾更自然。
- **占位符修复** — 消息发出后占位符及时结束，不会一直卡在"正在思考..."。

## v2.3.19（2026-03-19）

- **重要修复** — Bot WS 现在也真正走 `dynamicAgents`，会话隔离逻辑统一。
- **配置统一** — 媒体大小优先跟随 OpenClaw 标准 `mediaMaxMb`，支持账号级覆盖。
- **体验修复** — 默认额外放行 `Desktop`、`Downloads`、`Pictures` 等常见用户目录，本地文件发送更符合直觉。

## v2.3.18（2026-03-18）

- **重大升级** — 双平面能力融合（Bot WS + MCP 强化）。引入挂载式 MCP 能力层，大模型可凭用户身份读写待办、日程、查通讯录。
- **多账号硬隔离** — 重构 MCP 缓存池实现 `accountId + category` 二次硬维隔离，多企业助手上下文及鉴权缓存绝不交叉。
- **媒体通道重构** — 补齐 Bot WS 本地媒体上传链，设立 5 秒熔断机制，长通道大文件卡死时静默降级到 Agent 私信发送。

---

> 如需了解更早期的实验性功能或内测记录，请查看 [GitHub Releases](https://github.com/YanHaidao/wecom/releases)。
