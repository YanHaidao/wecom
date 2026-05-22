---
layout: default
title: 快速开始
parent: 快速开始
nav_order: 1
---

这一页帮你用最短路径把 `wecom` 跑起来。推荐先接 Bot WS，因为它不要求固定公网回调地址，适合先验证企业微信里的真实对话体验；确认可用后，再补 Agent 做正式回调、菜单事件和主动投递。

## 接入前准备
{: #前置条件 }

| 准备项 | 要求 | 说明 |
|:---|:---|:---|
| OpenClaw | `2026.3.23-2` 或更高版本 | 插件依赖 OpenClaw 当前渠道与向导能力 |
| 企业微信权限 | 能创建智能机器人或自建应用 | 至少需要拿到 Bot ID 与 Secret |
| 网络 | 能访问 `qyapi.weixin.qq.com` | 服务器出网受限时需要配置代理 |
| 运行环境 | Node.js 18+ | 生产环境建议使用受控进程管理方式 |

## 1. 安装并启用插件
{: #1-安装插件 }

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
{: #2-准备企业微信机器人 }

在企业微信管理后台进入 **工作台 / 智能机器人** 或对应的机器人管理页面，创建一个用于 OpenClaw 的机器人。你需要记录：

- `botId`：机器人 ID，部分后台界面也可能以 AgentId 的形式展示。
- `secret`：机器人密钥，只在配置时使用，建议不要写进公开仓库。

如果你当前后台使用的是自建应用入口，也可以先记录自建应用的 `AgentId` 与 `Secret`，后续 Agent 模式还会用到 `CorpID`、回调 `Token` 和 `EncodingAESKey`。

## 3. 用向导添加渠道
{: #3-通过向导快速接入 }

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
{: #5-手动配置示例 }

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
{: #4-验证运行状态 }

1. 在企业微信里找到刚创建的机器人或应用。
2. 发送一句简单消息，例如“你好，帮我总结一下今天要做什么”。
3. 查看 OpenClaw 是否收到消息并返回回复。
4. 如果没有回复，先执行状态探测，再看最近日志。

```bash
openclaw channels status --probe
openclaw channels logs --channel wecom --lines 200
```

## 6. 下一步

Bot WS 跑通后，如果你需要回调事件、主动推送、菜单事件或更正式的权限治理，请继续阅读：

- [配置说明]({{ site.baseurl }}/configuration/configuration.html) — 完整配置结构、字段解释、多账号矩阵、dynamicAgents、媒体目录
- [部署与发布]({{ site.baseurl }}/operation/deploy.html) — 生产环境部署、回调挂载、启动命令、升级策略
- [排障指南]({{ site.baseurl }}/operation/troubleshooting.html) — 按状态字段和日志命名空间定位问题
