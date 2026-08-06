---
layout: default
title: 排障指南
parent: 部署运维
nav_order: 2
---

遇到问题时，不要先猜代码。先用状态字段判断故障层级，再用日志确认具体链路。大多数问题都能在“配置是否完整、连接是否成功、凭证是否有效、目标是否可达、投递路径是否正确”这几个点里定位。

## 推荐排查顺序

```bash
openclaw channels status --probe
openclaw status --deep
openclaw channels logs --channel wecom --lines 200
```

| 命令 | 用途 |
|:---|:---|
| `openclaw channels status --probe` | 看 WeCom 插件账号是否配置、启动、连接、鉴权 |
| `openclaw status --deep` | 看 OpenClaw 网关整体是否健康 |
| `openclaw channels logs --channel wecom --lines 200` | 看最近 WeCom 入站、出站、错误和降级行为 |

## 状态字段怎么读

| 字段 | 异常表现 | 优先检查 |
|:---|:---|:---|
| `configured=false` | 插件没有识别到可用账号 | 配置层级、字段名、必填凭证 |
| `running=false` | 账号没有启动 | 插件是否启用、账号 `enabled`、启动日志 |
| `connected=false` | Bot WS 没连上 | 网络、代理、Bot ID、Secret |
| `authenticated=false` | 连接了但鉴权失败 | Secret 错误、机器人被禁用、权限变化 |
| `lastError` 持续变化 | 有持续运行错误 | 最近日志与错误栈 |

## 场景 1：`configured=false`

通常是配置结构没被插件解析到。

检查点：

- `channels.wecom.enabled` 是否为 `true`。
- 是否存在 `channels.wecom.accounts`。
- `defaultAccount` 是否指向一个真实存在的账号。
- 账号内是否至少配置了 `bot` 或 `agent`。
- Bot WS 是否有 `bot.ws.botId` 与 `bot.ws.secret`。
- Agent 是否有 `corpId`、`agentId`、`agentSecret`。

最小可用结构应类似：

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "bot": {
            "primaryTransport": "ws",
            "ws": {
              "botId": "YOUR_BOT_ID",
              "secret": "YOUR_BOT_SECRET"
            }
          }
        }
      }
    }
  }
}
```

## 场景 2：Bot WS 连接失败

表现：

- `connected=false`
- 日志里出现连接超时、握手失败、断线重连
- 企业微信里发消息没有进入 OpenClaw

排查顺序：

1. 确认服务器能访问企业微信接口。
2. 确认 Bot ID 与 Secret 没填反、没复制空格。
3. 确认企业微信后台机器人仍然启用。
4. 如果服务器在内网，检查 `network.egressProxyUrl`。
5. 看 `[wecom-ws]` 日志确认失败发生在连接、鉴权还是心跳阶段。

## 场景 3：Agent 回调保存失败

表现：

- 企业微信后台保存 URL、Token、EncodingAESKey 时失败。
- OpenClaw 没有收到回调验证请求。

检查点：

- 回调 URL 是否公网可访问，且使用 HTTPS。
- URL 是否包含账号 ID，例如 `/plugins/wecom/agent/default`。
- `agent.token` 与后台填写的 Token 是否一致。
- `agent.encodingAESKey` 与后台填写的 EncodingAESKey 是否一致。
- 反向代理是否把请求转发到了 OpenClaw。
- 防火墙是否开放 443 或对应端口。

多账号场景尤其要确认路径末尾：

```text
/plugins/wecom/agent/default
/plugins/wecom/agent/sales
/plugins/wecom/agent/ops
```

## 场景 4：能收到消息但不回复

这类问题通常分成两段：入站成功，出站失败。

先看日志是否有入站记录：

```bash
openclaw channels logs --channel wecom --lines 200
```

如果入站存在，再检查：

- OpenClaw Agent 是否可用。
- 动态路由是否把会话路由到了不存在或未启动的 Agent。
- `dm.policy` 是否拒绝了当前用户。
- Agent 主动发送时，用户是否在应用可见范围内。
- 群聊消息是否被策略过滤。

建议重点看：

| 日志 | 含义 |
|:---|:---|
| `[wecom-runtime]` | 消息是否进入统一运行时、路由到哪个 Agent |
| `[wecom-agent-delivery]` | 回复是否尝试通过 Agent 发送、目标解析是否成功 |
| `[wecom-ws]` | Bot WS 回复是否仍在会话链路内 |

## 场景 5：媒体或文件发送失败

常见原因：

- 文件路径不在 `media.localRoots` 中。
- 文件超过 `mediaMaxMb`。
- 企业微信自身不支持该文件类型或大小。
- 远程 URL 无法从服务器访问。
- Bot WS 大文件链路超时，需要 Agent 兜底。

检查配置：

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

判断方式：

| 现象 | 看哪里 |
|:---|:---|
| 本地文件存在但发不出 | `media.localRoots` |
| 小文件能发，大文件不能发 | `mediaMaxMb` 与企业微信限制 |
| URL 文件不能发 | 服务器是否能访问该 URL |
| 图片成功但多出无意义完成提示 | 检查插件版本是否已升级到较新版本 |

## 场景 6：上下游企业发错或发不出

检查点：

- 自建应用是否已经共享给上下游企业。
- 下游企业的 `CorpID` 是否写入 `agent.upstreamCorps`。
- 下游企业对应的 `agentId` 是否正确。
- 入站消息里的 `ToUserName` 是否能识别出下游企业。
- 日志中是否出现下游 token 获取失败。

配置示例：

```json
{
  "agent": {
    "corpId": "ww_primary_corp",
    "agentId": 1000001,
    "agentSecret": "PRIMARY_AGENT_SECRET",
    "upstreamCorps": {
      "ww_partner_corp": {
        "corpId": "ww_partner_corp",
        "agentId": 1000002
      }
    }
  }
}
```

## 常见企业微信错误码

| 错误码 | 常见含义 | 处理建议 |
|:---|:---|:---|
| `40014` | access_token 无效 | 检查 Secret、CorpID、token 缓存 |
| `40058` | 参数错误 | 看发送目标、消息类型、字段格式 |
| `40068` | AgentId 无效 | 检查 `agentId` 与应用是否一致 |
| `81013` | 用户不在应用可见范围 | 在企业微信后台调整应用可见范围 |
| `85002` | 回调 Token 或 AES Key 异常 | 对齐后台与配置文件 |

## 提交问题前建议收集

```bash
openclaw channels status --probe
openclaw status --deep
openclaw channels logs --channel wecom --lines 500
```

同时准备：

- 插件版本。
- OpenClaw 版本。
- 使用的是 Bot WS、Agent，还是双通道。
- 脱敏后的 `channels.wecom` 配置。
- 发生问题的时间点和用户/群聊场景。
