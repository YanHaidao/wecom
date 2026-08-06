---
layout: default
title: 上下游企业实现
parent: 上下游企业
nav_order: 1
---

# 上下游企业实现（识别 + 换 token + 发送）

本页详细说明上下游企业消息能力的实现原理、配置方法和常见问题处理，帮助你在企业微信中实现跨企业消息发送功能。

## 1. 背景说明

### 1.1 什么是上下游企业

上下游企业是指与企业微信母公司有业务关联的子公司、合作伙伴或供应商企业。通过企业微信的"上下游"功能，可以实现不同企业之间的信息互通和协作。

### 1.2 为什么要实现上下游消息能力

在企业实际业务中，经常需要：
- 向合作伙伴或供应商发送通知
- 接收来自下游企业的消息并处理
- 实现跨企业的自动化流程

### 1.3 为什么不能直接发送

上下游企业具有不同的 CorpID（企业标识），主企业（上游企业）的 Agent（应用）不能直接向下游企业用户发送消息。如果直接发送，会遇到企业微信返回的错误码 `81013`：

```
错误码：81013
错误信息：user & party & tag all invalid
错误原因：目标用户/部门/标签在当前应用不可见
```

这是因为企业微信的安全机制要求：发送消息时必须使用目标用户所在企业的 access_token 和 agentId。

## 2. 实现原理

### 2.1 整体架构

```
┌─────────────────┐    消息入站     ┌─────────────────┐
│   下游企业用户   │ ────────────> │   OpenClaw      │
│                  │               │   (wecom插件)    │
└─────────────────┘               └────────┬────────┘
                                           │
                                           │ 识别CorpID
                                           │ 发现是下游企业
                                           ▼
┌─────────────────┐               ┌─────────────────┐
│   主企业Agent   │ <────────────> │   消息路由      │
│                  │    换Token     │   (动态选择)    │
└────────┬────────┘               └────────┬────────┘
         │                                 │
         │ 使用主企业Token                  │ 使用下游企业Token
         │ 调用上下游接口                   │ 发送消息
         ▼                                 ▼
┌─────────────────┐               ┌─────────────────┐
│  企业微信API    │               │  下游企业用户   │
│ (corpgroup)    │               │                  │
└────────┬────────┘               └─────────────────┘
         │
         │ 获取下游企业Token
         ▼
┌─────────────────┐
│  下游企业API   │
│  (发送消息)    │
└─────────────────┘
```

### 2.2 消息处理流程

1. **消息识别**：入站时，比较消息的 `ToUserName` 与主企业 `corpId`
2. **企业映射**：根据 `agent.upstreamCorps` 找到目标下游企业映射
3. **换取Token**：使用主企业 access_token 调用 `corpgroup/corp/gettoken` 获取下游企业 access_token
4. **发送消息**：使用下游企业 access_token + 下游企业 agentId 发送消息

### 2.3 关键API说明

| API | 说明 | 使用场景 |
|-----|------|---------|
| `corpgroup/corp/gettoken` | 获取下游企业 access_token | 发送下游企业消息前调用 |
| `corpgroup/corp/list_app_share_info` | 获取应用共享信息 | 批量获取下游企业映射 |

## 3. 配置方法

### 3.1 完整配置示例

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
          },
          "agent": {
            "enabled": true,
            "corpId": "YOUR_PRIMARY_CORP_ID",
            "agentId": 1000001,
            "agentSecret": "YOUR_PRIMARY_AGENT_SECRET",
            "token": "YOUR_CALLBACK_TOKEN",
            "encodingAESKey": "YOUR_CALLBACK_AES_KEY",
            "upstreamCorps": {
              "DOWNSTREAM_CORP_ID_1": {
                "corpId": "DOWNSTREAM_CORP_ID_1",
                "agentId": 1000022
              },
              "DOWNSTREAM_CORP_ID_2": {
                "corpId": "DOWNSTREAM_CORP_ID_2",
                "agentId": 1000023
              }
            }
          }
        }
      }
    }
  }
}
```

### 3.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent.corpId` | string | 是 | 主企业（上游企业）的 CorpID |
| `agent.agentId` | number | 是 | 主企业的 AgentId |
| `agent.agentSecret` | string | 是 | 主企业的应用密钥 |
| `agent.token` | string | 否 | 回调验证 Token（启用回调模式时必填） |
| `agent.encodingAESKey` | string | 否 | 回调消息加密密钥（启用回调模式时必填） |
| `agent.upstreamCorps` | object | 是 | 下游企业映射配置 |
| `agent.upstreamCorps.<corpId>` | object | 是 | 下游企业配置节点 |
| `agent.upstreamCorps.<corpId>.corpId` | string | 是 | 下游企业的 CorpID |
| `agent.upstreamCorps.<corpId>.agentId` | number | 是 | 下游企业的 AgentId |

### 3.3 配置要点

1. **确认企业关系**：确保上下游企业关系已在企业微信管理后台正确配置
2. **获取正确的 AgentId**：下游企业的 agentId 必须是对应共享应用的 agentId
3. **配置权限**：确保主企业应用具有"上下游"相关接口的调用权限

## 4. 如何获取下游企业映射

### 4.1 手动获取

1. 登录企业微信管理后台
2. 进入 **应用管理** > **上下游** 页面
3. 查看已共享的应用，获取下游企业的 CorpID 和 AgentID

### 4.2 通过API批量获取

调用企业微信接口获取应用共享信息：

```bash
curl -X POST "https://qyapi.weixin.qq.com/cgi-bin/corpgroup/corp/list_app_share_info?access_token=YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentid": YOUR_AGENT_ID
  }'
```

返回示例：

```json
{
  "errcode": 0,
  "errmsg": "ok",
  "corp_list": [
    {
      "corpid": "DOWNSTREAM_CORP_ID_1",
      "agentid": 1000022,
      "corp_name": "下游企业A"
    },
    {
      "corpid": "DOWNSTREAM_CORP_ID_2",
      "agentid": 1000023,
      "corp_name": "下游企业B"
    }
  ]
}
```

将返回的 `corpid` 和 `agentid` 转换为 `upstreamCorps` 配置。

## 5. 使用示例

### 5.1 向下游企业用户发送文本消息

配置完成后，wecom 插件会自动处理 token 切换，你只需要正常使用 Agent 发送消息接口：

```bash
# 通过 OpenClaw API 发送消息
curl -X POST "http://localhost:3000/api/send" \
  -H "Content-Type: application/json" \
  -d '{
    "toUser": "downstream_user_openid",
    "message": "这是一条来自上游企业的通知",
    "corpId": "DOWNSTREAM_CORP_ID_1"
  }'
```

### 5.2 接收下游企业用户消息

当下游企业用户发送消息给应用时，插件会自动：
1. 识别消息来源企业
2. 使用对应企业的凭证处理消息
3. 确保回复使用正确的企业身份

## 6. 权限配置

### 6.1 主企业需要开通的权限

1. **基础权限**：
   - 应用消息推送权限
   - 接收消息权限

2. **上下游权限**：
   - 上下游->应用共享权限
   - 上下游->获取下游企业Token权限

### 6.2 下游企业需要完成的操作

1. **确认应用共享**：在企业微信管理后台确认接收来自主企业的应用共享
2. **配置可见范围**：确保需要接收消息的成员在应用的可见范围内
3. **配置应用权限**：确保应用具有发送消息的权限

## 7. 排障指南

### 7.1 常见错误码

| 错误码 | 错误信息 | 原因 | 解决方法 |
|--------|----------|------|----------|
| 81013 | user & party & tag all invalid | 直接使用主企业token发送下游消息 | 配置upstreamCorps，使用下游企业token发送 |
| 40014 | invalid access_token | token无效或已过期 | 重新获取access_token |
| 40013 | invalid corpid | CorpID不合法 | 检查corpId配置是否正确 |
| 30003 | no access | 无权限调用接口 | 检查应用权限配置 |

### 7.2 排查步骤

1. **检查配置完整性**：
   - 确认 `upstreamCorps` 配置了正确的 `corpId` 与 `agentId`
   - 确认主企业 `corpId`、`agentId`、`agentSecret` 配置正确

2. **检查企业关系**：
   - 确认下游企业已在企业微信管理后台正确配置
   - 确认应用共享已生效

3. **检查权限**：
   - 确认主企业应用具有上下游相关接口权限
   - 确认下游企业应用具有发送消息权限

4. **检查日志**：
   - 查看 OpenClaw 日志中的 corpId 和 agentId
   - 确认使用的是正确的下游企业凭证

### 7.3 日志分析方法

查看 OpenClaw 日志，重点关注以下信息：

```bash
openclaw logs --channel wecom --lines 200
```

重点日志字段：
- `targetCorpId`：目标企业 CorpID
- `targetAgentId`：目标企业 AgentID
- `accessTokenUsed`：使用的 access_token 对应的企业

## 8. 最佳实践

### 8.1 配置管理

1. **集中管理映射**：将所有下游企业映射配置在一个地方，便于维护
2. **定期更新**：当下游企业应用变更时，及时更新配置
3. **日志记录**：记录上下游消息发送日志，便于排查问题

### 8.2 安全性

1. **凭证安全**：不要将 agentSecret 等敏感信息硬编码在配置文件中
2. **Token管理**：定期刷新 access_token，避免使用过期 token
3. **权限最小化**：只为应用分配必要的权限

### 8.3 性能优化

1. **缓存Token**：缓存下游企业的 access_token，减少接口调用
2. **批量处理**：对于需要发送大量消息的场景，考虑批量处理
3. **错误重试**：配置合理的重试机制，提高消息送达率

## 9. 进阶用法

### 9.1 多级上下游

如果存在多级上下游关系（如：总公司 -> 子公司 -> 供应商），需要配置多级映射：

```json
{
  "agent": {
    "corpId": "ROOT_CORP_ID",
    "upstreamCorps": {
      "CHILD_CORP_ID": {
        "corpId": "CHILD_CORP_ID",
        "agentId": 1000001
      }
    }
  }
}
```

注意：企业微信支持的最大上下游层级数有限制，请参考官方文档。

### 9.2 条件路由

根据下游企业类型或消息内容，选择不同的处理策略：

```json
{
  "agent": {
    "upstreamCorps": {
      "PARTNER_CORP_ID": {
        "corpId": "PARTNER_CORP_ID",
        "agentId": 1000022,
        "routingRule": "partner"
      },
      "SUPPLIER_CORP_ID": {
        "corpId": "SUPPLIER_CORP_ID",
        "agentId": 1000023,
        "routingRule": "supplier"
      }
    }
  }
}
```

## 10. 相关文档

- [配置说明](../configuration/configuration)
- [功能实现原理](../functionality/implementation)
- [排障指南](../operation/troubleshooting)