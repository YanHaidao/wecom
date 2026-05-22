---
layout: default
title: 开发指南
parent: 关于项目
nav_order: 3
---

# 开发指南

本页面向希望为 WeCom 插件贡献代码、在本地调试或进行二次开发的开发者。

## 环境要求

| 项目 | 要求 |
|:---|:---|
| Node.js | 18 或更高版本 |
| OpenClaw | `2026.3.23-2` 或更高版本（用于集成调试） |
| Git | 任意较新版本 |
| 包管理器 | npm / yarn / pnpm 均可 |

> 本项目是一个 **OpenClaw 渠道插件**，没有独立的构建产物，依赖 OpenClaw 宿主运行时直接加载 TypeScript 源码。

## 插件架构概览

WeCom 插件的入口文件是 `index.ts`。它在 OpenClaw 启动时完成以下注册：

1. **注册渠道插件** — 通过 `src/channel.ts` 向 OpenClaw 注册 `wecom` 渠道。
2. **注册 HTTP 路由** — 挂载 `/plugins/wecom` 和 `/wecom` 前缀路由，统一接收企业微信的 Webhook 回调。
3. **注册协作工具** — 暴露 `wecom_doc`（文档）、`wecom_calendar`（日程）和 `wecom_mcp`（挂载式能力层）等工具。
4. **注入提示词** — 在 `before_prompt_build` 阶段为 Bot WS 会话注入 `MEDIA:` 发送指引。

## 仓库结构

```
wecom/
├── index.ts                    # 插件入口：注册渠道、路由、工具与钩子
├── index.test.ts               # 入口注册逻辑测试
├── package.json                # 插件元数据、依赖与 OpenClaw 扩展配置
├── tsconfig.json               # TypeScript 编译配置
├── vitest.config.ts            # 测试框架配置
├── scripts/
│   └── wecom/
│       ├── README.md           # 事件脚本输入输出协议文档
│       ├── menu-click-help.js  # Node.js 菜单事件示例
│       └── menu-click-help.py  # Python 菜单事件示例
├── src/
│   ├── agent/                  # 事件路由、处理器、脚本运行时
│   ├── app/                    # 账号运行时、启动入口
│   ├── capability/             # 能力层：doc、calendar、mcp、bot、agent
│   ├── config/                 # 配置结构、校验、派生路径、路由
│   ├── crypto/                 # AES 解密、签名验证、XML 解析
│   ├── domain/                 # 领域模型与策略定义
│   ├── monitor/                # 状态监控、限流、入站过滤
│   ├── observability/          # 审计日志、原始信包、状态注册表
│   ├── runtime/                # 派发器、出站编排、路由桥、会话管理
│   ├── shared/                 # 命令鉴权、媒体服务、XML 解析器
│   ├── store/                  # 活跃回复存储、内存存储、流批次存储
│   ├── transport/              # 传输层：Agent API、Agent Callback、Bot Webhook、Bot WS
│   ├── types/                  # 账号、配置、事件、消息、运行时上下文类型
│   ├── upstream/               # 上下游企业逻辑
│   └── wecom_msg_adapter/      # Markdown 适配器
├── docs/                       # 帮助文档站点（Jekyll + Just the Docs）
├── changelog/                  # 各版本详细变更简报
└── ...                         # 其他根级 Markdown 文档
```

## 本地开发流程

### 1. 克隆仓库

```bash
git clone https://github.com/YanHaidao/wecom.git
cd wecom
```

### 2. 安装依赖

```bash
npm install
```

> `package.json` 中没有定义 `scripts`，因此所有命令都通过 `npx` 直接调用。

### 3. 运行测试

本项目使用 [Vitest](https://vitest.dev/) 作为测试框架。

```bash
# 运行全部测试一次
npx vitest run

# 开发模式（监听文件变更）
npx vitest
```

测试配置位于 `vitest.config.ts`：
- 若项目位于 OpenClaw 扩展目录中，会自动复用上级目录的共享配置。
- 独立运行时，包含 `src/**/*.test.ts` 与 `index.test.ts`。

### 4. 类型检查

```bash
npx tsc --noEmit
```

`tsconfig.json` 已启用 `strict: true`，请确保代码通过严格类型检查。

### 5. 在 OpenClaw 中加载本地插件

由于本项目是 OpenClaw 插件，没有独立的 `build` 步骤，最终由 OpenClaw 宿主加载。

开发时，将插件目录放入 OpenClaw 的扩展目录中（例如 `extensions/wecom`），然后在 OpenClaw 配置中启用：

```bash
openclaw plugins enable wecom
```

修改代码后，重启 OpenClaw 即可加载最新版本。

## 事件脚本开发

WeCom 插件支持将自建应用的菜单事件路由到本地脚本处理。如果你需要开发这类脚本，核心要点如下：

### 输入协议（stdin）

脚本从 `stdin` 接收 JSON envelope：

```json
{
  "version": "1.0",
  "channel": "wecom",
  "accountId": "default",
  "receivedAt": 1760000000000,
  "message": {
    "msgType": "event",
    "eventType": "click",
    "eventKey": "MENU_HELP",
    "fromUser": "zhangsan",
    "agentId": 1000001
  },
  "route": {
    "matchedRuleId": "menu_help_click",
    "handlerType": "node_script"
  }
}
```

### 输出协议（stdout）

脚本向 `stdout` 输出 JSON：

```json
{
  "ok": true,
  "action": "reply_text",
  "reply": { "text": "已收到 MENU_HELP" },
  "chainToAgent": false
}
```

关键字段说明：

| 字段 | 说明 |
|:---|:---|
| `ok` | 脚本是否成功处理 |
| `action` | `reply_text` 直接回复 / `none` 不回复 |
| `reply.text` | 回复内容 |
| `chainToAgent` | 是否继续进入默认 Agent（AI）流程 |
| `error` | 错误信息（可选） |

> **注意**：`chainToAgent` 是脚本侧的动态结果，会与 handler 配置中的 `chainToAgent` 合并，只要任一方为 `true` 就会继续进入 Agent。

完整协议与示例请参见 [`scripts/wecom/README.md`](https://github.com/YanHaidao/wecom/blob/main/scripts/wecom/README.md)。

## 提交代码

1. 从 `main` 分支创建特性分支：
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. 提交变更，保持提交信息清晰：
   ```bash
   git commit -m "feat: 新增菜单事件路由支持"
   ```

3. 推送到你的 Fork 并提交 Pull Request：
   ```bash
   git push origin feature/your-feature-name
   ```

4. 在 PR 描述中说明：
   - 变更目的
   - 主要修改点
   - 测试方式与验证结果

## 开发注意事项

- **保持向后兼容**：配置结构变更时，尽量提供默认值或迁移提示。
- **日志规范**：新增功能时请使用恰当的日志级别（`debug` / `info` / `warn` / `error`），便于用户排障。
- **类型安全**：所有公共 API 和数据结构应附带 TypeScript 类型定义。
- **文档同步**：用户可见的变更必须同步更新 `docs/` 下的对应页面。
- **脚本安全**：事件脚本必须输出严格 JSON，调试日志写到 `stderr`，路径落在 `scriptRuntime.allowPaths` 内。

## 相关资源

- [`scripts/wecom/README.md`](https://github.com/YanHaidao/wecom/blob/main/scripts/wecom/README.md) — 事件脚本输入输出协议
- [GOVERNANCE.md](https://github.com/YanHaidao/wecom/blob/main/GOVERNANCE.md) — 项目治理与决策流程
- [GitHub Issues](https://github.com/YanHaidao/wecom/issues) — 提交 Bug 或功能请求
- [快速开始]({{ site.baseurl }}/quick-start/quick-start.html) — 快速验证插件运行
