---
layout: default
title: 功能实现原理
parent: 功能实现
nav_order: 1
---

# 功能实现原理（代码与配置映射）

本文档聚焦“功能是怎么实现的”，并把你关心的四份方案文档映射到可执行配置。

## 一、菜单事件能力如何实现

### 1.1 实现原理

来源：

- `MENU_EVENT_PLAN.md`
- `MENU_EVENT_CONF.md`

实现分三层：

1. **放通层**：通过 `inboundPolicy.eventEnabled` 与 `eventPolicy.allowedEventTypes` 决定哪些 `event` 能进入处理链路。
2. **路由层**：通过 `eventRouting.routes[].when` 做条件匹配（`eventType` / `eventKey` / `eventKeyPrefix` / `eventKeyPattern` / `changeType`）。
3. **执行层**：通过 `handler` 执行 `builtin`、`node_script`、`python_script`。

### 1.2 最终行为控制

最终行为由这几个字段决定：

- `eventRouting.unmatchedAction`：未命中路由后是 `ignore` 还是 `forwardToAgent`。
- `handler.chainToAgent` 与脚本返回 `chainToAgent`：两者任意一方是 `true`，都会继续进入默认 Agent 流程。

### 1.3 执行流程

1. 企业微信回调到 Agent
2. 入站策略判定：`eventEnabled` + `allowedEventTypes`
3. 路由规则按顺序匹配 `routes`（首条命中即执行）
4. handler 执行（内置/Node/Python）
5. 根据 `action` 与 `chainToAgent` 决定回复与是否继续默认 AI 流程

## 二、上下游企业能力如何实现

### 2.1 实现原理

来源：

- `UPSTREAM_PLAN.md`
- `UPSTREAM_CONFIG.md`

核心是“下游用户不能直接用主企业 Agent 发送”，所以要走下游 token：

1. 入站时通过消息 `ToUserName`（CorpID）与主企业 `corpId` 对比，识别是否上下游用户。
2. 从 `agent.upstreamCorps` 找到该下游企业映射（`corpId + agentId`）。
3. 用主企业 access_token 调 `corpgroup/corp/gettoken` 获取下游企业 access_token。
4. 出站阶段使用下游企业 access_token + 下游 `agentId` 发消息。

也就是：**识别目标企业 -> 换下游 token -> 用下游身份发送**。

### 2.2 关键 API

- `corpgroup/corp/gettoken`：获取下游企业 access_token
- `corpgroup/corp/list_app_share_info`：批量获取下游企业映射

### 2.3 处理流程

1. 消息入站，识别消息来源企业
2. 检查是否为上下游企业用户
3. 查找对应下游企业的配置
4. 换取下游企业 access_token
5. 使用下游企业身份发送消息

## 三、你应该怎么配置

### 3.1 菜单事件（最小可用）

```json
{
  "agent": {
    "inboundPolicy": {
      "eventEnabled": true,
      "eventPolicy": {
        "mode": "allowlist",
        "allowedEventTypes": ["click", "view", "scancode_push", "location_select"]
      }
    },
    "eventRouting": {
      "unmatchedAction": "forwardToAgent",
      "routes": [
        {
          "id": "menu-help",
          "when": { "eventType": "click", "eventKey": "MENU_HELP" },
          "handler": { "type": "node_script", "entry": "./scripts/wecom/menu-click-help.js" }
        }
      ]
    },
    "scriptRuntime": {
      "enabled": true,
      "allowPaths": ["./scripts/wecom"],
      "defaultTimeoutMs": 5000
    }
  }
}
```

### 3.2 上下游企业（最小可用）

```json
{
  "agent": {
    "corpId": "<PRIMARY_CORP_ID>",
    "agentId": 1000001,
    "agentSecret": "<PRIMARY_AGENT_SECRET>",
    "upstreamCorps": {
      "<UPSTREAM_CORP_ID>": {
        "corpId": "<UPSTREAM_CORP_ID>",
        "agentId": 1000022
      }
    }
  }
}
```

### 3.3 生产环境配置建议

- **菜单事件**：启用 `eventEnabled`，配置 `allowedEventTypes`，设置合理的路由规则
- **上下游企业**：配置 `upstreamCorps`，确保企业映射正确
- **安全配置**：使用环境变量存储敏感凭证，定期更新

## 四、代码与配置映射

### 4.1 菜单事件配置映射

| 配置字段 | 功能说明 | 对应文档 |
|---------|---------|----------|
| `inboundPolicy.eventEnabled` | 是否启用事件处理 | MENU_EVENT_PLAN.md |
| `eventPolicy.allowedEventTypes` | 允许的事件类型 | MENU_EVENT_PLAN.md |
| `eventRouting.routes` | 路由规则配置 | MENU_EVENT_CONF.md |
| `handler` | 事件处理器配置 | MENU_EVENT_CONF.md |
| `scriptRuntime` | 脚本运行时配置 | MENU_EVENT_CONF.md |

### 4.2 上下游企业配置映射

| 配置字段 | 功能说明 | 对应文档 |
|---------|---------|----------|
| `agent.corpId` | 主企业 CorpID | UPSTREAM_CONFIG.md |
| `agent.upstreamCorps` | 下游企业映射 | UPSTREAM_CONFIG.md |
| `agent.agentId` | 应用 AgentId | UPSTREAM_CONFIG.md |
| `agent.agentSecret` | 应用密钥 | UPSTREAM_CONFIG.md |

## 五、推荐阅读顺序

1. 先看 [菜单事件实现](./menu-event)
2. 再看 [上下游企业实现](../upstream/upstream)
3. 回到 [配置说明](../configuration/configuration) 合并成最终生产配置
4. 参考 [部署与发布](../operation/deploy) 进行部署
5. 遇到问题查看 [排障指南](../operation/troubleshooting)
