---
layout: default
title: 菜单事件实现
parent: 功能实现
nav_order: 2
---

# 菜单事件实现（配置 + 路由 + 脚本）

本页基于 `MENU_EVENT_PLAN.md` 与 `MENU_EVENT_CONF.md`，描述菜单事件从“收到回调”到“执行处理器”的完整流程，包含三处菜单事件的详细示例。

## 1. 处理链路

1. 企业微信回调到 Agent。
2. 入站策略先判定：`eventEnabled` + `allowedEventTypes`。
3. 路由规则按顺序匹配 `routes`（首条命中即执行）。
4. handler 执行（内置/Node/Python）。
5. 根据 `action` 与 `chainToAgent` 决定回复与是否继续默认 AI 流程。

## 2. 路由匹配字段

`eventRouting.routes[].when` 支持：

- `eventType`
- `eventKey`
- `eventKeyPrefix`
- `eventKeyPattern`
- `changeType`

典型做法：

- 菜单按钮：`eventType=click + eventKey=某个固定值`
- 通讯录变更：`eventType=change_contact + changeType=create_user`

## 3. 脚本输入输出协议

脚本通过 `stdin` 收到完整 envelope（含 `message.raw`），通过 `stdout` 返回 JSON。

### 3.1 输入字段

- `message.eventType`
- `message.eventKey`
- `message.fromUser`
- `message.raw`（原始解析字段全量透传）

### 3.2 输出字段

- `action`: `none | reply_text`
- `reply.text`
- `chainToAgent`

## 4. 菜单事件示例

### 4.1 示例一：帮助菜单

**功能描述**：点击帮助菜单，返回使用说明。

**配置**：

```json
{
  "id": "menu-help",
  "when": { "eventType": "click", "eventKey": "MENU_HELP" },
  "handler": { "type": "python_script", "entry": "./scripts/wecom/menu-click-help.py" }
}
```

**脚本示例** (`menu-click-help.py`)：

```python
import json
import sys

# 读取输入
envelope = json.load(sys.stdin)

# 构建回复
response = {
    "action": "reply_text",
    "reply": {
        "text": "欢迎使用 OpenClaw WeCom 机器人！\n\n" +
                "你可以：\n" +
                "1. 直接发送消息进行对话\n" +
                "2. 点击菜单按钮执行特定功能\n" +
                "3. 查看帮助文档了解更多" +
                "\n\n使用愉快！"
    },
    "chainToAgent": false
}

# 输出结果
print(json.dumps(response))
```

### 4.2 示例二：工单查询

**功能描述**：点击工单查询菜单，返回当前用户的工单状态。

**配置**：

```json
{
  "id": "menu-ticket",
  "when": { "eventType": "click", "eventKey": "MENU_TICKET" },
  "handler": { "type": "python_script", "entry": "./scripts/wecom/menu-click-ticket.py" }
}
```

**脚本示例** (`menu-click-ticket.py`)：

```python
import json
import sys

# 读取输入
envelope = json.load(sys.stdin)
from_user = envelope.get('message', {}).get('fromUser', '')

# 模拟查询工单
# 实际应用中，这里可以调用企业内部的工单系统 API
tickets = [
    {"id": "T20260421001", "status": "处理中", "subject": "系统故障", "created_at": "2026-04-21 10:00"},
    {"id": "T20260420002", "status": "已完成", "subject": "账号问题", "created_at": "2026-04-20 15:30"}
]

# 构建回复文本
ticket_text = f"你的工单状态：\n\n"
for ticket in tickets:
    ticket_text += f"工单编号：{ticket['id']}\n"
    ticket_text += f"状态：{ticket['status']}\n"
    ticket_text += f"主题：{ticket['subject']}\n"
    ticket_text += f"创建时间：{ticket['created_at']}\n\n"

# 构建回复
response = {
    "action": "reply_text",
    "reply": {
        "text": ticket_text
    },
    "chainToAgent": false
}

# 输出结果
print(json.dumps(response))
```

### 4.3 示例三：快速通知

**功能描述**：点击快速通知菜单，发送预设通知到指定群聊。

**配置**：

```json
{
  "id": "menu-notify",
  "when": { "eventType": "click", "eventKey": "MENU_NOTIFY" },
  "handler": { "type": "python_script", "entry": "./scripts/wecom/menu-click-notify.py" }
}
```

**脚本示例** (`menu-click-notify.py`)：

```python
import json
import sys

# 读取输入
envelope = json.load(sys.stdin)

# 构建回复
response = {
    "action": "reply_text",
    "reply": {
        "text": "通知已发送到工作群！\n\n" +
                "通知内容：\n" +
                "各位同事，今天下午 3 点将召开周会，请准时参加。"
    },
    "chainToAgent": false
}

# 输出结果
print(json.dumps(response))

# 实际应用中，这里可以调用企业微信 API 发送群聊消息
# 例如：
# import requests
# def send_group_message(chat_id, content):
#     # 实现发送群聊消息的逻辑
#     pass
# send_group_message("GROUP_ID", "各位同事，今天下午 3 点将召开周会，请准时参加。")
```

## 5. 完整配置模板

```json
{
  "agent": {
    "inboundPolicy": {
      "eventEnabled": true,
      "eventPolicy": {
        "mode": "allowlist",
        "allowedEventTypes": ["click", "view", "scancode_push"]
      }
    },
    "eventRouting": {
      "unmatchedAction": "forwardToAgent",
      "routes": [
        {
          "id": "menu-help",
          "when": { "eventType": "click", "eventKey": "MENU_HELP" },
          "handler": { "type": "python_script", "entry": "./scripts/wecom/menu-click-help.py" }
        },
        {
          "id": "menu-ticket",
          "when": { "eventType": "click", "eventKey": "MENU_TICKET" },
          "handler": { "type": "python_script", "entry": "./scripts/wecom/menu-click-ticket.py" }
        },
        {
          "id": "menu-notify",
          "when": { "eventType": "click", "eventKey": "MENU_NOTIFY" },
          "handler": { "type": "python_script", "entry": "./scripts/wecom/menu-click-notify.py" }
        }
      ]
    },
    "scriptRuntime": {
      "enabled": true,
      "allowPaths": ["./scripts/wecom"],
      "defaultTimeoutMs": 5000,
      "pythonCommand": "python3",
      "nodeCommand": "node"
    }
  }
}
```

## 6. 企业微信菜单配置

### 6.1 配置步骤

1. 登录企业微信管理后台
2. 进入 **应用管理** > **自建** > 选择你的应用
3. 点击 **自定义菜单** 选项卡
4. 点击 **添加菜单**，配置菜单名称和事件类型
5. 选择 **点击事件**，填写 `Key` 值（与配置中的 `eventKey` 对应）
6. 保存菜单配置

### 6.2 菜单配置示例

| 菜单名称 | 事件类型 | Key 值 | 对应处理脚本 |
|---------|---------|--------|-------------|
| 帮助 | 点击 | MENU_HELP | menu-click-help.py |
| 工单查询 | 点击 | MENU_TICKET | menu-click-ticket.py |
| 快速通知 | 点击 | MENU_NOTIFY | menu-click-notify.py |

## 7. 与规划文档的对应关系

- 放通策略：对应 `MENU_EVENT_PLAN.md` 的 `inboundPolicy` 设计。
- 路由器与 handler：对应 `MENU_EVENT_PLAN.md` 的 `eventRouting` 与执行模型。
- 配置示例与脚本协议：对应 `MENU_EVENT_CONF.md` 的完整示例与输入输出格式。

## 8. 排障指南

### 8.1 常见问题

| 问题 | 原因 | 解决方法 |
|------|------|----------|
| 菜单点击无响应 | 未开启 `eventEnabled` | 在 `inboundPolicy` 中设置 `eventEnabled: true` |
| 脚本不执行 | 脚本路径错误或权限不足 | 检查脚本路径是否正确，确保脚本有执行权限 |
| 回复不显示 | `action` 字段设置错误 | 确保返回正确的 `action` 字段值 |

### 8.2 日志排查

查看 OpenClaw 日志，重点关注以下信息：

```bash
openclaw logs --channel wecom --lines 200
```

重点日志字段：
- `eventType`：事件类型
- `eventKey`：事件 Key
- `handler`：执行的处理器
- `scriptOutput`：脚本输出
- `error`：错误信息
