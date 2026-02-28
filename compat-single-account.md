# 附录 A：WeCom 单账号兼容模式配置指南

> 本文档用于历史部署或小规模场景。  
> 新项目默认推荐多账号矩阵配置（`accounts + bindings.match.accountId`）。

## A.1 适用场景

- 已在线运行单账号配置，短期内不希望迁移。
- 只有一个 Bot / Agent，不需要账号隔离。
- 本地 PoC 或临时验证链路。

## A.2 快速配置

### A.2.1 仅 Bot（单智能体）

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.bot.token "YOUR_BOT_TOKEN"
openclaw config set channels.wecom.bot.encodingAESKey "YOUR_BOT_AES_KEY"
openclaw config set channels.wecom.bot.receiveId ""
openclaw config set channels.wecom.bot.streamPlaceholderContent "正在思考..."
openclaw config set channels.wecom.bot.welcomeText "你好！我是 AI 助手"

# DM 门禁（推荐显式设置 policy）
openclaw config set channels.wecom.bot.dm.policy "open"
openclaw config set channels.wecom.bot.dm.allowFrom '["*"]'
```

### A.2.2 增加 Agent 兜底（可选）

```bash
openclaw config set channels.wecom.agent.corpId "YOUR_CORP_ID"
openclaw config set channels.wecom.agent.corpSecret "YOUR_CORP_SECRET"
openclaw config set channels.wecom.agent.agentId 1000001
openclaw config set channels.wecom.agent.token "YOUR_CALLBACK_TOKEN"
openclaw config set channels.wecom.agent.encodingAESKey "YOUR_CALLBACK_AES_KEY"
openclaw config set channels.wecom.agent.welcomeText "欢迎使用智能助手"
openclaw config set channels.wecom.agent.dm.policy "open"
openclaw config set channels.wecom.agent.dm.allowFrom '["*"]'
```

### A.2.3 验证

```bash
openclaw gateway restart
openclaw channels status
```

## A.3 完整单账号配置结构

```jsonc
{
  "channels": {
    "wecom": {
      "enabled": true,

      "bot": {
        "aibotid": "BOT_ID_OPTIONAL",
        "token": "YOUR_BOT_TOKEN",
        "encodingAESKey": "YOUR_BOT_AES_KEY",
        "botIds": ["BOT_ID_OPTIONAL"],
        "receiveId": "",
        "streamPlaceholderContent": "正在思考...",
        "welcomeText": "你好！我是 AI 助手",
        "dm": {
          "policy": "open",
          "allowFrom": ["*"]
        }
      },

      "agent": {
        "corpId": "YOUR_CORP_ID",
        "corpSecret": "YOUR_CORP_SECRET",
        "agentId": 1000001,
        "token": "YOUR_CALLBACK_TOKEN",
        "encodingAESKey": "YOUR_CALLBACK_AES_KEY",
        "welcomeText": "欢迎使用智能助手",
        "dm": {
          "policy": "open",
          "allowFrom": ["*"]
        }
      },

      "media": {
        "tempDir": "/tmp/openclaw-wecom-media",
        "retentionHours": 24,
        "cleanupOnStart": true,
        "maxBytes": 26214400
      },

      "network": {
        "timeoutMs": 15000,
        "retries": 2,
        "retryDelayMs": 500,
        "egressProxyUrl": "http://proxy.company.local:3128"
      },

      "dynamicAgents": {
        "enabled": false,
        "dmCreateAgent": false,
        "groupEnabled": false,
        "adminUsers": []
      }
    }
  }
}
```

## A.4 Webhook 路径

- Bot: `/wecom/bot`
- Agent: `/wecom/agent`

## A.5 迁移建议

如果后续需要多 Bot / 多 Agent 隔离，建议迁移到多账号矩阵模式：
- 在 `channels.wecom.accounts.<accountId>` 下拆分配置
- 通过 `bindings[].match.accountId` 映射到对应 OpenClaw agent
