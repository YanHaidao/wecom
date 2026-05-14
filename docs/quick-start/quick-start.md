---
layout: default
title: 快速开始
parent: 快速开始
nav_order: 1
---

这一页帮你用最短路径把 `wecom` 跑起来。推荐先接 Bot WS，因为它不要求固定公网回调地址，适合先验证企业微信里的真实对话体验；确认可用后，再补 Agent 做正式回调、菜单事件和主动投递。

## 接入前准备

| 准备项 | 要求 | 说明 |
|:---|:---|:---|
| OpenClaw | `2026.3.23-2` 或更高版本 | 插件依赖 OpenClaw 当前渠道与向导能力 |
| 企业微信权限 | 能创建智能机器人或自建应用 | 至少需要拿到 Bot ID 与 Secret |
| 网络 | 能访问 `qyapi.weixin.qq.com` | 服务器出网受限时需要配置代理 |
| 运行环境 | Node.js 18+ | 生产环境建议使用受控进程管理方式 |

## 1. 安装并启用插件

```bash
openclaw plugins install @yanhaidao/wecom
openclaw plugins enable wecom
```

安装后可以先看插件是否已被 OpenClaw 识别：

```bash
openclaw channels list
```

如果列表里能看到 `wecom`，说明插件已经进入 OpenClaw 的渠道目录。

## 2. 准备 Bot WS 凭证

在企业微信管理后台进入 **工作台 / 智能机器人** 或对应的机器人管理页面，创建一个用于 OpenClaw 的机器人。你需要记录：

- `botId`：机器人 ID，部分后台界面也可能以 AgentId 的形式展示。
- `secret`：机器人密钥，只在配置时使用，建议不要写进公开仓库。

如果你当前后台使用的是自建应用入口，也可以先记录自建应用的 `AgentId` 与 `Secret`，后续 Agent 模式还会用到 `CorpID`、回调 `Token` 和 `EncodingAESKey`。

## 3. 用向导添加渠道

```bash
openclaw channels add
```

在向导里选择 `WeCom` 或 `企业微信`，然后按提示填入 Bot ID 与 Secret。向导完成后，OpenClaw 会写入渠道配置并尝试启动连接。

成功时，你通常会看到类似“Channel added successfully”的提示。随后立刻做一次状态探测：

```bash
openclaw channels status --probe
```

重点看这些字段：

| 字段 | 期望值 | 含义 |
|:---|:---|:---|
| `configured` | `true` | 配置完整，插件能解析到账号 |
| `running` | `true` | WeCom 运行时已经启动 |
| `connected` | `true` | Bot WS 已建立连接 |
| `authenticated` | `true` | Bot 凭证通过校验 |
| `lastError` | 空或非持续刷新 | 没有持续性运行错误 |

## 4. 手动配置最小可用 Bot WS

如果你不使用向导，可以在 OpenClaw 配置中加入最小配置：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "name": "企业微信 AI 助手",
          "bot": {
            "primaryTransport": "ws",
            "streamPlaceholderContent": "正在思考中，请稍候...",
            "ws": {
              "botId": "${WECOM_BOT_ID}",
              "secret": "${WECOM_BOT_SECRET}"
            }
          }
        }
      }
    }
  }
}
```

敏感信息建议放到环境变量：

```bash
export WECOM_BOT_ID="your-bot-id"
export WECOM_BOT_SECRET="your-bot-secret"
```

## 5. 发送第一条测试消息

1. 在企业微信里找到刚创建的机器人或应用。
2. 发送一句简单消息，例如“你好，帮我总结一下今天要做什么”。
3. 查看 OpenClaw 是否收到消息并返回回复。
4. 如果没有回复，先执行状态探测，再看最近日志。

```bash
openclaw channels status --probe
openclaw channels logs --channel wecom --lines 200
```

## 6. 下一步补 Agent

当 Bot WS 已经跑通后，如果你需要以下能力，就应继续配置 Agent：

- 企业微信后台回调事件，例如菜单点击、扫码、上报地理位置。
- 主动给用户、部门、标签或上下游企业发送消息。
- 更正式的权限治理、回调验签和应用身份能力。
- Bot WS 之外的兜底投递链路。

Agent 的最小配置示例：

```json
{
  "channels": {
    "wecom": {
      "accounts": {
        "default": {
          "agent": {
            "corpId": "${WECOM_CORP_ID}",
            "agentId": 1000001,
            "agentSecret": "${WECOM_AGENT_SECRET}",
            "token": "${WECOM_CALLBACK_TOKEN}",
            "encodingAESKey": "${WECOM_ENCODING_AES_KEY}"
          }
        }
      }
    }
  }
}
```

Agent 配置完成后，需要在企业微信后台把回调 URL 指向：

```text
https://你的域名/plugins/wecom/agent/default
```

如果你的账号不是 `default`，把路径末尾换成对应的 `accountId`。

## 7. 快速判断问题在哪

| 现象 | 优先检查 | 常见原因 |
|:---|:---|:---|
| `configured=false` | 配置结构与字段名 | `accounts` 层级错误、缺少 `bot.ws.secret` |
| `connected=false` | Bot WS 网络与凭证 | Secret 错误、服务器不能出网、机器人未启用 |
| 企业微信后台回调保存失败 | Agent 回调 URL | 域名不可访问、Token/AES Key 不一致、HTTPS 证书异常 |
| 能收不能发 | 投递链路和可见范围 | 应用可见范围未包含用户、AgentId 错误 |
| 本地图片或文件发不出 | `media.localRoots` 与大小限制 | 文件目录未放行、超过 `mediaMaxMb` |

更完整的定位步骤请继续看 [排障指南]({{ site.baseurl }}/operation/troubleshooting.html)。
