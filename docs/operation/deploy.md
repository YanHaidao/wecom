---
layout: default
title: 部署与发布
parent: 部署运维
nav_order: 1
---

这一页面向准备上线的人：如何部署插件、配置回调、验证状态、升级回滚，以及上线前要检查哪些风险点。

## 部署形态建议

| 形态 | 适合场景 | 特点 |
|:---|:---|:---|
| Bot WS 单通道 | 快速试用、小团队、无公网地址 | 配置少，体验快，但组织级主动投递能力有限 |
| Agent 单通道 | 正式应用回调、菜单事件、主动消息 | 治理清晰，但对实时聊天体验不是最优 |
| Bot WS + Agent | 生产推荐 | 实时体验和企业级能力兼顾 |

生产环境建议使用第三种：Bot WS 承接用户正在等待的实时对话，Agent 承接回调、菜单事件、主动发送和兜底投递。

## 1. 环境要求

| 项目 | 要求 |
|:---|:---|
| Node.js | 18 或更高版本 |
| OpenClaw | `2026.3.23-2` 或更高版本 |
| 出网 | 能访问 `qyapi.weixin.qq.com` |
| Agent 回调 | 公网 HTTPS 域名，企业微信后台可访问 |
| 进程管理 | 建议使用 systemd、PM2、Docker 或平台自带守护能力 |

## 2. 安装与启用

```bash
openclaw plugins install @yanhaidao/wecom
openclaw plugins enable wecom
```

启用后检查渠道是否出现：

```bash
openclaw channels list
```

## 3. 配置生产凭证

建议使用环境变量管理敏感信息：

```bash
export WECOM_BOT_ID="your-bot-id"
export WECOM_BOT_SECRET="your-bot-secret"
export WECOM_CORP_ID="your-corp-id"
export WECOM_AGENT_SECRET="your-agent-secret"
export WECOM_CALLBACK_TOKEN="your-callback-token"
export WECOM_ENCODING_AES_KEY="your-encoding-aes-key"
```

配置文件只引用变量：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "name": "生产企业微信助手",
          "bot": {
            "primaryTransport": "ws",
            "ws": {
              "botId": "${WECOM_BOT_ID}",
              "secret": "${WECOM_BOT_SECRET}"
            }
          },
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

## 4. 配置 Agent 回调

在企业微信后台自建应用中填写回调 URL：

```text
https://你的域名/plugins/wecom/agent/default
```

同时填入与配置文件一致的：

- `Token`
- `EncodingAESKey`

如果是多账号，URL 最后一段必须和账号 ID 一致：

| 账号 ID | 回调 URL |
|:---|:---|
| `default` | `/plugins/wecom/agent/default` |
| `sales` | `/plugins/wecom/agent/sales` |
| `ops` | `/plugins/wecom/agent/ops` |

不要把多个账号都指向同一个无账号路径，否则后续扩展时很容易出现回调归属混乱。

## 5. 启动与检查

启动 OpenClaw：

```bash
openclaw start
```

检查 WeCom 渠道：

```bash
openclaw channels status --probe
```

再检查全局运行状态：

```bash
openclaw status --deep
```

上线前至少确认：

- `configured=true`
- `running=true`
- Bot WS 场景下 `connected=true`
- Bot WS 场景下 `authenticated=true`
- 企业微信后台回调保存成功
- 测试用户在应用可见范围内
- 企业微信里发送文本消息可收到回复
- 如果要发送图片或文件，本地目录已加入 `media.localRoots`

## 6. 日志与观测

```bash
openclaw channels logs --channel wecom --lines 200
```

常见日志命名空间：

| 命名空间 | 看什么 |
|:---|:---|
| `[wecom-runtime]` | 统一运行时、消息分发、账号归属、最近错误 |
| `[wecom-ws]` | Bot WS 连接、鉴权、断线重连、心跳 |
| `[wecom-agent-delivery]` | Agent 主动发送、用户/部门/标签目标解析、媒体投递 |
| `[wecom-agent-callback]` | Agent 回调、验签、解密、事件入站 |

## 7. 升级流程

升级前建议先备份 OpenClaw 配置：

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak.$(date +%Y%m%d)
```

升级插件：

```bash
openclaw plugins update @yanhaidao/wecom
openclaw channels restart wecom
openclaw channels status --probe
```

升级后建议做三类验证：

1. Bot WS 私聊收发。
2. Agent 回调保存与事件入站。
3. 媒体文件或图片发送。

## 8. 发布前检查清单

- 配置文件没有明文 Secret。
- 回调域名使用 HTTPS，证书有效。
- 企业微信应用可见范围包含测试用户。
- 多账号路径带有明确 accountId。
- `dynamicAgents` 的开关符合实际使用规模。
- `media.localRoots` 没有放开过大的本地目录。
- 出网代理配置已在生产机器上验证。
- 已记录最近一次可用配置备份。
