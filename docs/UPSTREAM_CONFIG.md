# WeCom 插件上下游企业配置指南

## 背景

企业微信的「上下游」功能允许企业与其经销商、供应商、合作伙伴便捷沟通、共享应用。

## 问题

- 上下游企业的 CorpID 与主企业不同
- 上下游企业只能使用 Agent 渠道（没有 Bot 渠道）
- 需要使用下游企业的 access_token 来发送消息

## 解决方案

修改后的 WeCom 插件支持通过配置 `upstreamCorps` 来发送消息给上下游用户。

## 配置方法

在 `openclaw.json` 中，为需要支持上下游的账号添加 `upstreamCorps` 配置：

```json
{
  "channels": {
    "wecom": {
      "accounts": {
        "<ACCOUNT_ID>": {
          "enabled": true,
          "name": "<ACCOUNT_NAME>",
          "agent": {
            "corpId": "<PRIMARY_CORP_ID>",
            "agentId": <PRIMARY_AGENT_ID>,
            "agentSecret": "<PRIMARY_AGENT_SECRET>",
            "token": "<PRIMARY_CALLBACK_TOKEN>",
            "encodingAESKey": "<PRIMARY_ENCODING_AES_KEY>",
            "welcomeText": "<WELCOME_TEXT>",
            "dm": {
              "policy": "open",
              "allowFrom": []
            },
            "upstreamCorps": {
              "<UPSTREAM_CORP_KEY>": {
                "corpId": "<UPSTREAM_CORP_ID>",
                "agentId": <UPSTREAM_AGENT_ID>
              }
            }
          },
          "bot": {
            "primaryTransport": "webhook",
            "streamPlaceholderContent": "正在思考...",
            "welcomeText": "<BOT_WELCOME_TEXT>",
            "dm": {
              "policy": "open",
              "allowFrom": []
            },
            "webhook": {
              "token": "<BOT_WEBHOOK_TOKEN>",
              "encodingAESKey": "<BOT_WEBHOOK_ENCODING_AES_KEY>"
            }
          }
        }
      }
    }
  }
}
```

占位符说明：

1. `<ACCOUNT_ID>`: OpenClaw 中的 WeCom 账号 ID（如 `default`、`lab`）。
2. `<PRIMARY_CORP_ID>` / `<PRIMARY_AGENT_ID>`: 上游（主）企业应用信息。
3. `<UPSTREAM_CORP_ID>` / `<UPSTREAM_AGENT_ID>`: 下游企业应用信息（可由 95813 接口返回）。
4. `<UPSTREAM_CORP_KEY>`: `upstreamCorps` 的配置键，建议与 `<UPSTREAM_CORP_ID>` 保持一致。

## 配置说明

### upstreamCorps 字段

- **key**: 下游企业标识（推荐直接使用下游 CorpID，例如 `<UPSTREAM_CORP_ID>`）
- **value**: 该下游企业的 Agent 配置
  - `corpId`: 下游企业的 CorpID
  - `agentId`: 下游企业的 AgentID

## 获取下游企业配置信息

1. **CorpID**: 从企业微信管理后台获取，或从消息回调中的 `ToUserName` 字段获取
2. **AgentID**: 从企业微信管理后台 - 应用管理 中获取
3. **AgentSecret**: 仅主企业应用需要配置（用于获取主企业 access_token）

### 通过接口自动获取（推荐）

你也可以通过企业微信官方接口「获取应用共享信息」批量拉取上下游企业的 `corpid` 与 `agentid`：

- 文档: https://developer.work.weixin.qq.com/document/path/95813
- 接口: `POST https://qyapi.weixin.qq.com/cgi-bin/corpgroup/corp/list_app_share_info?access_token=ACCESS_TOKEN`

请求体示例（上下游场景）：

```json
{
  "agentid": <PRIMARY_AGENT_ID>,
  "business_type": 1,
  "limit": 100
}
```

参数要点：

1. `access_token` 使用上游企业应用的 access_token。
2. `business_type` 传 `1` 表示上下游企业。
3. `agentid` 传上游企业当前应用的 AgentID。
4. 当企业较多时，用 `cursor` + `next_cursor` 分页拉取，直到 `ending=1`。

返回字段映射到配置：

1. `corp_list[].corpid` -> `upstreamCorps.<key>.corpId`
2. `corp_list[].agentid` -> `upstreamCorps.<key>.agentId`

示例返回（节选）：

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "ending": 0,
  "next_cursor": "<NEXT_CURSOR>",
  "corp_list": [
    {
      "corpid": "<UPSTREAM_CORP_ID>",
      "corp_name": "<UPSTREAM_CORP_NAME>",
      "agentid": <UPSTREAM_AGENT_ID>
    }
  ]
}
```

可直接转换成：

```json
{
  "upstreamCorps": {
    "<UPSTREAM_CORP_KEY>": {
      "corpId": "<UPSTREAM_CORP_ID>",
      "agentId": <UPSTREAM_AGENT_ID>
    }
  }
}
```

提示：如果某个下游企业未在 `corp_list` 中出现，通常是该企业还未确认应用共享或共享未生效。

## 工作原理

1. 当收到消息时，插件检测消息中的 `ToUserName`（CorpID）
2. 如果 `ToUserName` 与主 CorpID 不同，则识别为上下游用户
3. 回复时使用 `wecom-agent-upstream:{accountId}:{corpId}:{userId}` 格式的 target
4. Outbound 模块解析该 target，使用对应的上下游 Agent 配置发送消息

## 日志示例

```
[wecom-agent] detected upstream user: from=<UPSTREAM_USER_ID> toCorpId=<UPSTREAM_CORP_ID>
[wecom-outbound] Sending text to upstream target=wecom-agent-upstream:<ACCOUNT_ID>:<UPSTREAM_CORP_ID>:<UPSTREAM_USER_ID> corpId=<UPSTREAM_CORP_ID>
[wecom-outbound] Successfully sent upstream Agent text to wecom-agent-upstream:<ACCOUNT_ID>:<UPSTREAM_CORP_ID>:<UPSTREAM_USER_ID>
```

## 注意事项

1. `upstreamCorps` 仅需配置下游 `corpId` 与 `agentId`，不需要下游 `agentSecret`
2. 上下游企业需要在企业微信管理后台配置「可调用接口的应用」
3. 上游企业需要将应用共享给下游企业
