---
layout: default
title: 常见问题
parent: 部署运维
nav_order: 3
---

# 常见问题（FAQ）

## 部署相关

### Q1：Bot WS 和 Agent 有什么区别？

| 对比项 | Bot WS | Agent |
|--------|--------|-------|
| 配置难度 | ⭐ 简单 | ⭐⭐⭐ 较复杂 |
| 对话体验 | ⭐⭐⭐ 最佳 | ⭐⭐ 良好 |
| 公网要求 | 无需固定IP | 需要固定IP |

**推荐**：先用 Bot WS 跑起来，后续平滑补 Agent

### Q2：最少要配什么？

只需一个 Bot WS 账号即可：
```json
{
  "bot": {
    "ws": {
      "botId": "YOUR_BOT_ID",
      "secret": "YOUR_BOT_SECRET"
    }
  }
}
```

## 配置相关

### Q3：凭证在哪里获取？

在企业微信管理后台 > 应用管理 > 自建应用 获取：
- `botId` / `agentId`
- `secret`

### Q4：如何管理敏感信息？

使用环境变量：
```bash
export WECOM_BOT_ID="your-bot-id"
export WECOM_BOT_SECRET="your-bot-secret"
```

在配置中引用：`${WECOM_BOT_ID}`

## 功能相关

### Q5：如何给上下游企业发消息？

在配置中添加 `upstreamCorps`：
```json
{
  "agent": {
    "upstreamCorps": {
      "DOWNSTREAM_KEY": {
        "corpId": "DOWNSTREAM_CORP_ID",
        "agentId": DOWNSTREAM_AGENT_ID
      }
    }
  }
}
```

详细见：[上下游企业实现](../upstream/upstream)

### Q6：如何配置菜单事件？

在配置中添加 `eventRouting`：
```json
{
  "agent": {
    "eventRouting": {
      "routes": [
        {
          "when": { "eventType": "click" },
          "handler": { "type": "node_script" }
        }
      ]
    }
  }
}
```

详细见：[菜单事件实现](../functionality/menu-event)

## 运维相关

### Q7：如何升级插件？

```bash
openclaw plugins update @yanhaidao/wecom
openclaw channels restart wecom
```

### Q8：如何备份配置？

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak.$(date +%Y%m%d)
```
