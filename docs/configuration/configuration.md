---
layout: default
title: 配置说明
parent: 配置说明
nav_order: 1
---

`channels.wecom` 是插件的主配置入口。建议把它理解成三层：全局开关、账号矩阵、账号内的 Bot/Agent 能力。小团队可以只配一个 `default` 账号；生产环境、多部门、多企业或上下游场景，建议把账号边界写清楚。

## 配置总览

```jsonc
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "name": "默认企业微信助手",
          "bot": {},
          "agent": {}
        }
      },
      "mediaMaxMb": 50,
      "media": {},
      "network": {},
      "dynamicAgents": {}
    }
  }
}
```

| 🗂️ 区域 | 🎯 作用 | ⏰ 什么时候需要关注 |
|:---|:---|:---|
| `enabled` | 是否启用 WeCom 渠道 | 所有场景都需要 |
| `defaultAccount` | 没有显式命中账号时的默认账号 | 单账号也建议保留 |
| `accounts` | 多账号矩阵 | 多企业、多机器人、多部门隔离 |
| `bot` | Bot WS / Bot Webhook 相关配置 | 快速接入、实时对话、流式回复 |
| `agent` | 自建应用 Agent 配置 | 回调、主动发送、菜单事件、上下游企业 |
| `media` / `mediaMaxMb` | 媒体文件发送与本地路径放行 | 发送图片、文件、语音、视频 |
| `dynamicAgents` | 动态会话隔离 | 多人共用、群聊、长期上下文 |
| `network` | 代理与出网设置 | 内网、受限网络、企业代理 |

在企业微信后台创建机器人或应用后，即可拿到初始凭证：

![注册与创建应用]({{ site.baseurl }}/assets/configuration-images/register.png)

## 最小 Bot WS 配置

适合先跑通对话，不需要固定公网 IP。

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "name": "wecom-bot",
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

字段说明：

| ⚙️ 字段 | ✅ 必填 | 📝 说明 |
|:---|:---:|:---|
| `bot.primaryTransport` | 是 | 建议先用 `ws` |
| `bot.ws.botId` | 是 | 企业微信机器人 ID |
| `bot.ws.secret` | 是 | 企业微信机器人 Secret |
| `bot.streamPlaceholderContent` | 否 | 长任务开始前的占位提示，减少用户等待焦虑 |
| `bot.welcomeText` | 否 | 首次接入或特定场景下的欢迎文本 |

Bot 配置步骤示例：

![Bot 添加步骤 1]({{ site.baseurl }}/assets/configuration-images/01.bot-add.png)
![Bot 添加步骤 2]({{ site.baseurl }}/assets/configuration-images/01.bot-setp2.png)
![Bot 页面概览]({{ site.baseurl }}/assets/configuration-images/03.bot.page.png)

配置完成后，企业微信中的 Bot 聊天效果如下：

![Bot 聊天界面]({{ site.baseurl }}/assets/configuration-images/01%20bot聊天界面.jpg)

## 生产推荐配置

生产环境建议同时配置 Bot 与 Agent：Bot 负责实时对话体验，Agent 负责正式应用能力、主动投递和回调事件。

```jsonc
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "name": "总部 AI 助手",
          "bot": {
            "primaryTransport": "ws",
            "streamPlaceholderContent": "正在处理，请稍候...",
            "ws": {
              "botId": "${WECOM_BOT_ID}",
              "secret": "${WECOM_BOT_SECRET}"
            },
            "dm": {
              "policy": "pairing",
              "allowFrom": []
            }
          },
          "agent": {
            "corpId": "${WECOM_CORP_ID}",
            "agentId": 1000001,
            "agentSecret": "${WECOM_AGENT_SECRET}",
            "token": "${WECOM_CALLBACK_TOKEN}",
            "encodingAESKey": "${WECOM_ENCODING_AES_KEY}",
            "dm": {
              "policy": "open",
              "allowFrom": []
            }
          }
        }
      },
      "mediaMaxMb": 50,
      "media": {
        "tempDir": "/tmp/openclaw-wecom-media",
        "localRoots": [
          "/srv/company-share",
          "/data/reports"
        ]
      },
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["admin-userid"]
      }
    }
  }
}
```

## Agent 字段说明

| ⚙️ 字段 | ✅ 必填 | 📄 来源 | 📝 说明 |
|:---|:---:|:---|:---|
| `agent.corpId` | 是 | 企业微信企业信息 | 企业 ID |
| `agent.agentId` | 是 | 自建应用详情页 | 应用 AgentId，通常是数字 |
| `agent.agentSecret` | 是 | 自建应用详情页 | 应用 Secret |
| `agent.token` | 回调时必填 | 自行生成并填入后台 | 企业微信回调校验 Token |
| `agent.encodingAESKey` | 回调时必填 | 自行生成并填入后台 | 企业微信消息加解密 Key |
| `agent.upstreamCorps` | 上下游场景必填 | 企业微信上下游配置 | 下游企业 CorpID 与 AgentId 映射 |

回调 URL 的默认形式：

```text
https://你的域名/plugins/wecom/agent/default
```

多账号时，`default` 要替换为账号 ID，例如：

```text
https://你的域名/plugins/wecom/agent/sales
```

Agent 配置步骤示例：

![Agent 添加]({{ site.baseurl }}/assets/configuration-images/02.agent.add.png)
![Agent API 设置]({{ site.baseurl }}/assets/configuration-images/02.agent.api-set.png)
![Agent 页面概览]({{ site.baseurl }}/assets/configuration-images/03.agent.page.png)

配置完成后，企业微信中的 Agent 聊天效果如下：

![Agent 聊天界面]({{ site.baseurl }}/assets/configuration-images/02.agent聊天界面.jpg)

## 多账号配置

多账号适合这些场景：

- 同一 OpenClaw 实例服务多个企业微信应用。
- 不同部门需要不同机器人、欢迎语、权限和上下文边界。
- 测试账号与生产账号并存。

```jsonc
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "sales",
      "accounts": {
        "sales": {
          "enabled": true,
          "name": "销售支持助手",
          "bot": {
            "primaryTransport": "ws",
            "ws": {
              "botId": "${WECOM_SALES_BOT_ID}",
              "secret": "${WECOM_SALES_BOT_SECRET}"
            }
          }
        },
        "ops": {
          "enabled": true,
          "name": "运维值班助手",
          "agent": {
            "corpId": "${WECOM_OPS_CORP_ID}",
            "agentId": 1000002,
            "agentSecret": "${WECOM_OPS_AGENT_SECRET}",
            "token": "${WECOM_OPS_TOKEN}",
            "encodingAESKey": "${WECOM_OPS_AES_KEY}"
          }
        }
      }
    }
  }
}
```

## dynamicAgents 会话隔离

`dynamicAgents` 解决的是“多人共用一个入口时，如何避免上下文混在一起”。开启后，插件会按账号、会话类型和对端 ID 生成稳定的动态 Agent。

| 📍 场景 | 💡 建议 |
|:---|:---|
| 多个同事私聊同一个机器人 | 开启 `enabled` 和 `dmCreateAgent` |
| 多个群长期使用同一个机器人 | 开启 `groupEnabled` |
| 管理员需要直接进入主 Agent 排查 | 把管理员 userId 放入 `adminUsers` |
| 单人 PoC 或临时演示 | 可以先不启用 |

```json
{
  "channels": {
    "wecom": {
      "dynamicAgents": {
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["zhangsan001"]
      }
    }
  }
}
```

dynamicAgents 配置页效果如下：

![dynamicAgents 配置页]({{ site.baseurl }}/assets/configuration-images/dynamicAgents配置页.png)

## 媒体与本地文件

`mediaMaxMb` 控制最大媒体大小，`media.localRoots` 控制哪些本地目录允许被读取并发送到企业微信。

```json
{
  "channels": {
    "wecom": {
      "mediaMaxMb": 50,
      "media": {
        "localRoots": [
          "/srv/company-share",
          "/data/reports"
        ]
      }
    }
  }
}
```

建议：

- 使用绝对路径，避免不同启动目录导致解析差异。
- 只放行业务确实需要的目录。
- 不要把整个磁盘或整个用户目录加入 `localRoots`。
- 如果远程 URL 文件能访问但本地文件失败，优先检查 `localRoots`。

## 网络代理

企业内网或受限出网环境可以配置代理：

```json
{
  "channels": {
    "wecom": {
      "network": {
        "egressProxyUrl": "http://127.0.0.1:3128"
      }
    }
  }
}
```

配置后建议重新探测：

```bash
openclaw channels status --probe
```

## 安全建议

- 不要把 Secret、Token、EncodingAESKey 提交到公开仓库。
- 使用环境变量、密钥管理服务或部署平台的 secret 功能。
- 给 Agent 设置最小可见范围，只开放必要用户、部门或标签。
- 媒体目录只放行必要路径。
- 多账号时为每个账号使用独立凭证，避免排障时无法判断消息归属。

## 配置完成后的验证

```bash
openclaw channels status --probe
openclaw channels logs --channel wecom --lines 200
```

验证顺序：

1. `configured=true`：配置被正确解析。
2. `running=true`：运行时启动成功。
3. `connected=true`：Bot WS 已连接。
4. `authenticated=true`：凭证有效。
5. 企业微信里发送测试消息，确认能收到回复。
