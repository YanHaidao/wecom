# YanHaidao/wecom

<p align="center">
  <img src="https://img.shields.io/badge/Original%20Project-YanHaidao-orange?style=for-the-badge&logo=github" alt="Original Project" />
  <img src="https://img.shields.io/badge/License-ISC-blue?style=for-the-badge" alt="License" />
</p>

面向 OpenClaw 2026.8.1 及更高兼容版本的全功能企业微信插件。

本项目以腾讯企业微信团队维护的
[`WecomTeam/wecom-openclaw-plugin`](https://github.com/WecomTeam/wecom-openclaw-plugin)
为 Channel 主线，保留官方 Bot、Agent、`wecom-cli` 和 Skills 能力，并融合 YanHaidao 版本的
多账号隔离、上下游企业路由、文档与日历增强工具、动态 Agent、诊断和隐私安全日志。

> [!WARNING]
> **原创与归属声明**：本项目的“多账号隔离与矩阵路由架构”、“Bot + Agent 双模融合架构”、
> “长任务超时接力逻辑”及“全自动媒体流转接”等设计与增强能力，是作者
> **YanHaidao** 独立思考与实践的原创成果。欢迎依据 ISC 许可证进行技术交流、使用、修改与
> 合规引用，但必须保留许可证要求的版权及许可声明；不得删除原作者署名或冒充原创。
> 从腾讯官方主线迁入的代码不属于上述原创声明范围，其来源、基线与 MIT 许可归属见
> [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

> 本插件的 ID 是 `wecom`，会独占 OpenClaw 的 `wecom` Channel。不要同时启用
> `wecom-openclaw-plugin`，否则会出现 Channel 所有权、Webhook 路由或消息目标冲突。

## 兼容范围

| 组件 | 要求 |
|---|---|
| OpenClaw | `>= 2026.8.1` |
| Node.js | `>=22.22.3 <23`、`>=24.15.0 <25` 或 `>=25.9.0`；推荐 Node 24.15+ |
| 插件包 | `@yanhaidao/wecom` |
| 插件 ID | `wecom` |
| 当前开发线 | [`v3.0.0`](changelog/v3.0.0.md)（开发中，尚未发布） |
| 当前腾讯官方同步基线 | `WecomTeam/wecom-openclaw-plugin@2026.8.17` (`3b1cbe3e6643`) |

如果你直接在 OpenClaw 源码仓库运行命令，请把本文的 `openclaw` 替换为：

```bash
node openclaw.mjs
```

## 能力概览

- Bot WebSocket：推荐的接入方式，支持实时收发、流式回复、媒体、模板卡片、心跳和重连。
- Bot Webhook：使用 JSON 加密回调，可用于不能保持 WebSocket 长连接的部署环境。
- Agent Webhook：支持企业微信自建应用的 XML 加密回调和 HTTP API 主动发送。
- Bot 优先、Agent 兜底：Bot 无法完成的主动投递或文件交付可切换到对应账号的 Agent。
- 多账号：每个账号独立管理 Bot、Webhook、Agent、访问策略和凭据，避免跨账号串号。
- 官方业务工具：`wecom-cli` 与 16 个 Skills，覆盖消息、通讯录、文档、表格、日历、会议、
  邮件、微盘、待办和媒体。
- 企业增强工具：`wecom_doc` 与 `wecom_calendar` 补充高级权限、外部记录、收集表、
  日历容器和系统日历操作。
- 上下游企业：`upstreamCorps` 支持企业身份识别、下游令牌交换及跨企业消息回复。
- 运维能力：`openclaw wecom diagnose --json`、配置迁移、结构化流程日志和敏感信息脱敏。

## 快速开始：Bot WebSocket

这是 OpenClaw 2026.8.1 下最短、最稳定的使用路径。

### 1. 检查运行环境

```bash
node --version
openclaw --version
```

如果 OpenClaw 提示 Node 版本不受支持，请先切换到 Node 24.15 或更新的受支持版本。

### 2. 处理官方插件冲突

先检查当前插件：

```bash
openclaw plugins list
```

如果已经启用腾讯官方插件，请禁用它：

```bash
openclaw plugins disable wecom-openclaw-plugin
```

只保留一个 `wecom` Channel 所有者。

### 3. 安装插件

从 npm 安装正式包：

```bash
openclaw plugins install --accept-capabilities @yanhaidao/wecom
```

升级或覆盖已有安装时可以使用：

```bash
openclaw plugins install --accept-capabilities --force @yanhaidao/wecom
```

验证插件已经加载：

```bash
openclaw plugins inspect wecom
```

输出应包含 `Status: loaded`、`channel: wecom` 和当前插件版本。

### 4. 配置企业微信 Bot

推荐使用 OpenClaw 2026.8.1 的 Channel Setup Contract：

```bash
openclaw channels add wecom \
  --account main \
  --name '企业微信' \
  --connection-mode websocket \
  --bot-id '<WECOM_BOT_ID>' \
  --secret '<WECOM_BOT_SECRET>'
openclaw config set channels.wecom.defaultAccount main
```

所有新配置都应显式提供 `--account`。本文统一使用 `main`，后续增加其他账号时不需要迁移配置结构。

### 5. 启用业务工具

插件会注册三个工具：`wecom-cli`、`wecom_doc` 和 `wecom_calendar`。推荐按插件 ID 放行：

```bash
openclaw config get tools.alsoAllow
openclaw config set tools.alsoAllow '["wecom"]'
```

`config set` 会替换整个数组。如果现有配置还允许其他插件或工具，请先读取原值，再把 `wecom`
合并进去，不要直接覆盖其他条目。例如：

```bash
openclaw config set tools.alsoAllow '["browser","wecom"]'
```

### 6. 校验配置并启动 Gateway

```bash
openclaw config validate
openclaw wecom diagnose --json
```

前台运行，适合首次调试：

```bash
openclaw gateway run
```

需要长期后台运行时，先安装一次系统服务：

```bash
openclaw gateway install
openclaw gateway start
```

已经安装服务时，可以使用：

```bash
openclaw gateway restart
```

不要同时启动前台 Gateway 和系统服务。出现“Another gateway already owns this state directory”时，
先执行 `openclaw gateway status`，然后停止已有实例或继续使用它。

### 7. 验证连接

```bash
openclaw channels status --probe
```

成功状态类似：

```text
企业微信 main (企业微信): enabled, configured, running, connected, works
```

随后在企业微信中向 Bot 发送一条普通文本。日志应依次出现
`inbound_received`、`inbound_parsed`、路由/策略阶段和发送完成阶段。

## 打开 OpenClaw Web 管理页

Gateway 默认端口为 `18789`。本机访问：

[http://127.0.0.1:18789/](http://127.0.0.1:18789/)

检查页面是否可访问：

```bash
curl -I http://127.0.0.1:18789/
```

如果日志显示 `control ui build rejected`，请对页面执行强制刷新，或清除该站点缓存后重新打开。

不要在没有 Gateway 认证和网络访问控制的情况下把管理页暴露到公网。使用 `gateway.bind=lan`
时，局域网地址通常为 `http://<本机局域网IP>:18789/`。

## 配置模式

### Bot WebSocket（推荐）

所需凭据：

- `botId`
- `secret`

即使当前只有一个机器人，也统一使用 `accounts` 结构：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "accounts": {
        "main": {
          "enabled": true,
          "name": "企业微信",
          "connectionMode": "websocket",
          "botId": "<WECOM_BOT_ID>",
          "secret": "<WECOM_BOT_SECRET>"
        }
      }
    }
  }
}
```

除非企业微信明确提供了不同地址，否则不要修改默认 WebSocket 地址
`wss://openws.work.weixin.qq.com`。

### Bot Webhook

所需凭据：

- `token`
- `encodingAESKey`
- 可选 `receiveId`

使用 Setup Contract 配置：

```bash
openclaw channels add wecom \
  --account main \
  --connection-mode webhook \
  --token '<WECOM_CALLBACK_TOKEN>' \
  --encoding-aes-key '<WECOM_ENCODING_AES_KEY>' \
  --receive-id '<WECOM_RECEIVE_ID>'
```

推荐回调路径：`https://<gateway-host>/plugins/wecom/bot/<accountId>`，例如
`https://<gateway-host>/plugins/wecom/bot/main`。

兼容路径 `/wecom` 和 `/wecom/bot` 仅用于已有部署迁移；新配置应使用
`/plugins/wecom/bot/<accountId>`。

### Agent 自建应用

Agent 模式用于 XML 回调、主动消息、部门/标签投递，以及 Bot 无法直接交付文件时的兜底。

需要在企业微信管理后台准备：

- CorpID
- CorpSecret
- AgentId
- 回调 Token
- EncodingAESKey

Agent 配置也放在所属账号下面：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "accounts": {
        "main": {
          "enabled": true,
          "name": "企业微信",
          "agent": {
            "corpId": "<WECOM_CORP_ID>",
            "corpSecret": "<WECOM_CORP_SECRET>",
            "agentId": 1000002,
            "token": "<WECOM_CALLBACK_TOKEN>",
            "encodingAESKey": "<WECOM_ENCODING_AES_KEY>"
          }
        }
      }
    }
  }
}
```

推荐回调路径：`https://<gateway-host>/plugins/wecom/agent/<accountId>`，例如
`https://<gateway-host>/plugins/wecom/agent/main`。

先启动 Gateway，再在企业微信管理后台保存回调地址。保存时企业微信会立即发送 URL 校验请求。

### Bot 与 Agent 同时使用

Bot 与 Agent 可以配置在同一账号中。Bot 负责实时会话和流式回复，Agent 提供主动发送、
文件兜底及自建应用回调：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "accounts": {
        "main": {
          "enabled": true,
          "name": "企业微信",
          "connectionMode": "websocket",
          "botId": "<WECOM_BOT_ID>",
          "secret": "<WECOM_BOT_SECRET>",
          "agent": {
            "corpId": "<WECOM_CORP_ID>",
            "corpSecret": "<WECOM_CORP_SECRET>",
            "agentId": 1000002,
            "token": "<WECOM_CALLBACK_TOKEN>",
            "encodingAESKey": "<WECOM_ENCODING_AES_KEY>"
          }
        }
      }
    }
  }
}
```

## 多账号

多账号是本项目的默认配置模型，不是兼容补丁。即使当前只接入一个机器人，也使用
`channels.wecom.accounts.main`。每个账号必须拥有自己的 Bot/Webhook/Agent 凭据。

### 使用 CLI 添加账号

```bash
openclaw channels add wecom \
  --account main \
  --name '主机器人' \
  --connection-mode websocket \
  --bot-id '<MAIN_BOT_ID>' \
  --secret '<MAIN_BOT_SECRET>'

openclaw channels add wecom \
  --account support \
  --name '客服机器人' \
  --connection-mode websocket \
  --bot-id '<SUPPORT_BOT_ID>' \
  --secret '<SUPPORT_BOT_SECRET>'

openclaw config set channels.wecom.defaultAccount main
openclaw config validate
openclaw gateway restart
openclaw channels status --probe
```

### 多账号配置结构

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "main",
      "accounts": {
        "main": {
          "enabled": true,
          "name": "主机器人",
          "connectionMode": "websocket",
          "botId": "<MAIN_BOT_ID>",
          "secret": "<MAIN_BOT_SECRET>",
          "dmPolicy": "open",
          "groupPolicy": "open"
        },
        "support": {
          "enabled": true,
          "name": "客服机器人",
          "connectionMode": "websocket",
          "botId": "<SUPPORT_BOT_ID>",
          "secret": "<SUPPORT_BOT_SECRET>",
          "dmPolicy": "allowlist",
          "allowFrom": ["<SUPPORT_USER_ID>"],
          "groupPolicy": "allowlist",
          "groupAllowFrom": ["<SUPPORT_CHAT_ID>"]
        }
      }
    }
  }
}
```

每个账号都应显式配置自己的访问策略、媒体和网络设置。Bot ID、Bot Secret 和 Agent 凭据
同样必须按账号配置，不依赖隐式继承。

### 绑定账号与 Agent

多账号部署应为每个账号配置明确的 OpenClaw binding：

```json
{
  "bindings": [
    {
      "agentId": "main-agent",
      "match": { "channel": "wecom", "accountId": "main" }
    },
    {
      "agentId": "support-agent",
      "match": { "channel": "wecom", "accountId": "support" }
    }
  ]
}
```

缺少账号上下文、显式跨账号调用、`upstreamCorps` 映射歧义时，增强工具会失败关闭，避免使用错误企业凭据。

## 业务工具与 Skills

### `wecom-cli`

官方标准业务入口。工具参数是 `@wecom/cli` 的命令参数数组，例如：

```json
{
  "args": ["--help"]
}
```

对应 Skills 覆盖：

- 消息与媒体
- 通讯录
- 在线文档、智能文档
- 在线表格、智能表格
- 日历、会议、会议纪要
- 邮件、微盘、待办

### `wecom_doc`

保留 YanHaidao 版本的文档增强能力，包括权限诊断、分享校验、收集表、高级权限和外部记录。
这些能力并非对 `wecom-cli` 的简单重复。

### `wecom_calendar`

保留日历容器与系统日历增强操作。官方标准日程操作仍优先使用 `wecom-cli`。

增强工具绑定当前企业微信会话的 `accountId`。在普通 Web 会话或无法解析账号的多账号会话中，
工具可能不会显示或会拒绝执行，这是防串号设计。

## 访问控制

### 单聊策略

`dmPolicy` 支持：

- `open`：允许所有用户。
- `pairing`：通过 OpenClaw 配对审批。
- `allowlist`：只允许 `allowFrom` 中的用户。
- `disabled`：禁用单聊。

配对命令：

```bash
openclaw pairing list wecom
openclaw pairing approve wecom <PAIRING_CODE>
```

生产环境建议使用 `pairing` 或 `allowlist`。

### 群聊策略

`groupPolicy` 支持 `open`、`allowlist` 和 `disabled`。白名单模式示例：

```json
{
  "channels": {
    "wecom": {
      "defaultAccount": "main",
      "accounts": {
        "main": {
          "groupPolicy": "allowlist",
          "groupAllowFrom": ["<WECOM_CHAT_ID>"],
          "groups": {
            "<WECOM_CHAT_ID>": {
              "allowFrom": ["<WECOM_USER_ID>"]
            }
          }
        }
      }
    }
  }
}
```

## 媒体与主动投递

| 类型 | Bot/插件限制 | 超限行为 |
|---|---:|---|
| 图片 | 10 MB | 尝试作为文件发送 |
| 视频 | 10 MB | 尝试作为文件发送 |
| 语音 | 2 MB，AMR | 非 AMR 或超限时尝试作为文件发送 |
| 文件 | 20 MB | 拒绝发送并返回可诊断错误 |

允许读取本地媒体时，应显式配置 `mediaLocalRoots`，不要开放整个用户目录或文件系统根目录。

主动发送目标支持：

- `user:<userid>`
- `party:<department-id>` 或 `dept:<department-id>`
- `tag:<tag-id>`
- `group:<chat-id>` 或 `chat:<chat-id>`

部门、标签和多数主动媒体投递需要对应账号的 Agent 配置。

## 定时任务

使用 OpenClaw 2026.8.1 的 Cron/Automations CLI，不要直接编辑内部存储文件：

```bash
openclaw cron add \
  --name 'wecom-daily-report' \
  --agent main-agent \
  --cron '0 9 * * 1-5' \
  --tz 'Asia/Shanghai' \
  --message '生成今天的工作简报。' \
  --announce \
  --channel wecom \
  --to 'party:1'
```

常用命令：

```bash
openclaw cron list
openclaw cron show <JOB_ID>
openclaw cron run <JOB_ID>
openclaw cron runs --id <JOB_ID>
openclaw cron disable <JOB_ID>
openclaw cron enable <JOB_ID>
openclaw cron rm <JOB_ID>
```

多账号投递需要在任务中指定正确的 WeCom 账号；部门和标签投递需要 Agent 凭据与企业微信可信 IP。

## 从旧版本升级

### 从本插件改版前的多账号版本升级

当前版本继续兼容改版前的多账号配置，并通过 Doctor 迁移以下结构：

- `accounts.<id>.bot.ws.botId` → `accounts.<id>.botId`
- `accounts.<id>.bot.ws.secret` → `accounts.<id>.secret`
- `accounts.<id>.agent.agentSecret` → `accounts.<id>.agent.corpSecret`
- 旧 Bot/Agent DM 子配置 → 当前账号级访问控制字段

推荐流程：

```bash
openclaw gateway stop
openclaw plugins update wecom
openclaw doctor --fix --non-interactive
openclaw config validate
openclaw gateway start
openclaw channels status --probe
openclaw wecom diagnose --json
```

如果 Gateway 没有安装为系统服务，请跳过 `gateway stop/start`，更新后重新运行
`openclaw gateway run`。

### 从腾讯官方插件切换

两个插件共享 `channels.wecom` 配置，但不能同时拥有 Channel：

```bash
openclaw gateway stop
openclaw plugins disable wecom-openclaw-plugin
openclaw plugins install --accept-capabilities @yanhaidao/wecom
openclaw doctor --fix --non-interactive
openclaw config validate
openclaw gateway start
openclaw channels status --probe
```

切换前请备份 `~/.openclaw/openclaw.json`。不要把真实密钥提交到 Git。

## 本地源码开发

### 构建插件

```bash
git clone https://github.com/YanHaidao/wecom.git
cd wecom
npm ci --ignore-scripts --workspaces=false
npm test
npm run build
```

### 链接到 OpenClaw 2026.8.1

在 OpenClaw 仓库根目录运行：

```bash
node openclaw.mjs plugins install --link --accept-capabilities ../wecom
node openclaw.mjs config set tools.alsoAllow '["wecom"]'
node openclaw.mjs config validate
node openclaw.mjs gateway run
```

修改插件源码后重新执行：

```bash
cd ../wecom
npm test
npm run build
```

然后重启 Gateway。链接模式会继续使用当前目录，不需要重复复制插件文件。

## 诊断与排错

### 一组完整的只读检查

```bash
openclaw plugins inspect wecom
openclaw plugins doctor
openclaw config validate
openclaw wecom diagnose --json
openclaw gateway status --deep
openclaw channels status --probe
```

### `Another gateway already owns this state directory`

同一个 `OPENCLAW_STATE_DIR` 已经有 Gateway：

```bash
openclaw gateway status
openclaw gateway stop
```

只有在确认已有实例应停止时才执行 `gateway stop`。前台运行的 Gateway 应在对应终端中退出。

### Channel 显示 configured，但没有 connected

依次检查：

1. 当前账号的 `botId` 与 `secret` 是否属于同一个企业微信 Bot。
2. `connectionMode` 是否为 `websocket`。
3. Node.js 是否满足 OpenClaw 2026.8.1 的版本要求。
4. 日志中是否出现 `socket_connected`、`authenticated` 或明确的认证错误。
5. 多账号下是否把凭据写在了正确的 `accounts.<accountId>` 中。

### Channel connected，但消息没有回复

```bash
openclaw channels status --probe
openclaw wecom diagnose --json
```

然后查看当天日志：

```bash
tail -f /tmp/openclaw/openclaw-$(date +%F).log
```

当前插件会记录 `trace`、`account`、`stage`、耗时、字节数和媒体数量，但不会记录原始消息正文、
密钥、用户 ID、消息 ID 或本地文件路径。

### 工具没有出现

确认整个插件已经放行：

```bash
openclaw config get tools.alsoAllow
openclaw config set tools.alsoAllow '["wecom"]'
openclaw gateway restart
```

再检查工具契约：

```bash
openclaw plugins list --json
```

`wecom` 条目应包含 `wecom-cli`、`wecom_doc` 和 `wecom_calendar`。

### Webhook 返回 401 或签名验证失败

检查回调 URL 对应的账号、Token、EncodingAESKey 和 ReceiveId/CorpID。多账号部署优先使用带
`accountId` 的推荐路径，避免多个账号使用相同回调路径时发生签名匹配歧义。

## 官方主线同步

腾讯官方仓库仅作为只读上游。检查新版本：

```bash
npm run upstream:check
```

基线记录在 [UPSTREAM_BASELINE.json](UPSTREAM_BASELINE.json)。融合原则与验收范围见：

- [OFFICIAL_PLUGIN_MIGRATION.md](OFFICIAL_PLUGIN_MIGRATION.md)
- [OFFICIAL_CAPABILITY_ACCEPTANCE.md](OFFICIAL_CAPABILITY_ACCEPTANCE.md)
- [docs/UPSTREAM_CONFIG.md](docs/UPSTREAM_CONFIG.md)

同步时只把经过审查的官方变化迁移到本仓库，不向腾讯官方仓库提交或推送代码。

## 发布到 npm

仓库使用 GitHub Actions 和 npm Trusted Publishing。推送与 `package.json.version` 一致的版本标签后，
工作流会依次校验发布元数据、安装锁定依赖、运行测试、构建、生成并检查 tarball，然后把同一个
tarball 发布到 npm；成功后再创建对应的 GitHub Release。

### 一次性配置 npm Trusted Publisher

在 npm 网站打开 `@yanhaidao/wecom` 的包设置，添加 GitHub Actions Trusted Publisher：

- Organization or user：`YanHaidao`
- Repository：`wecom`
- Workflow filename：`release.yml`
- Environment：`release`

仓库的 `release` Environment 名称必须与 npm 设置完全一致。工作流使用 OIDC，不需要配置
`NPM_TOKEN`；首次验证发布成功后，应删除仓库中遗留的 npm 发布令牌。

### 发布一个新版本

先手动修改 `package.json` 中的 `version`，例如从 `2.7.260` 改为 `2.7.261`。然后完成本地检查，
提交版本修改并推送到 GitHub：

```bash
npm ci --ignore-scripts --workspaces=false
npm test
npm run build
git add package.json
git commit -m "release: v2.7.261"
git push origin main
```

确认 GitHub 上的目标提交和版本号无误后，为该提交创建同版本标签 `v2.7.261`。可以在 GitHub
Release 页面创建标签，也可以在本地执行：

```bash
git tag v2.7.261
git push origin v2.7.261
```

标签必须严格等于 `v` 加 `package.json.version`。不要复用或移动已经发布过的版本标签，因为 npm
的同一包版本不能覆盖发布。

标签推送后，在 GitHub 的 Actions 页面查看 `Publish npm package`。发布完成后验证：

```bash
npm view @yanhaidao/wecom version
npm view @yanhaidao/wecom dist-tags --json
```

当前 `2.7.260` 已经发布且已有 `v2.7.260` 标签，因此下一次发布必须先提升版本号，不能重新发布
`2.7.260`。

## 项目协作者

感谢所有为本项目提交代码、测试、文档与反馈的协作者。

<p align="center">
  <a href="https://github.com/YanHaidao/wecom/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=YanHaidao/wecom" alt="WeCom contributors" />
  </a>
</p>

如果头像墙没有立即刷新，通常是 GitHub 统计或第三方缓存延迟，稍后再查看即可。

## 联系作者

- 维护者与原创作者：[YanHaidao](https://github.com/YanHaidao)
- 企业微信交流群：扫描下方二维码进群交流、反馈问题或讨论企业定制需求。

![企业微信交流群](https://openclaw.cc/wechat-github.jpg)

## 许可证与版权

YanHaidao 原创与增强部分：Copyright © 2026 YanHaidao。

本项目以 [ISC License](LICENSE) 发布。你可以依据许可证使用、复制、修改和分发本项目，
但须保留许可证规定的版权及许可声明。

来自腾讯官方插件的代码继续遵循其 MIT 许可；对应来源、同步基线和完整归属说明见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。该第三方归属与 YanHaidao 原创增强部分的
署名同时保留，互不替代。

开源不是拿来主义。本项目中的多账号切面、Bot + Agent 保活接力与超时融合机制、自动路由
下沉等能力，来自作者在企业真实环境中的持续实践。请在使用和再发布时尊重许可证、保留署名，
不要以删除作者信息或改名换姓的方式占为己有。
