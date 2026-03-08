# DM Policy 实现分析

本文档分析 WeCom 插件中 `dm.policy` 配置的实现机制。

## 概述

`dm.policy` 用于控制单聊（Direct Message）的访问策略，支持 Bot 和 Agent 两种模式独立配置。

## 支持的策略类型

| 策略值 | 名称 | 说明 |
|--------|------|------|
| `pairing` | 配对模式（默认） | 需要配对或显式添加白名单 |
| `allowlist` | 白名单模式 | 仅允许 `allowFrom` 列表中的用户 |
| `open` | 开放模式 | 允许所有人发起对话 |
| `disabled` | 禁用模式 | 完全禁止单聊（命令和普通消息都会被拒绝） |

### 注意事项

- **WeCom 不支持配对 CLI**：由于 WeCom 渠道不支持 `openclaw pairing` 命令行工作流，`pairing` 模式实际上被当作 `allowlist` 处理
- 两种模式独立配置：`bot.dm.policy` 和 `agent.dm.policy` 可以设置不同的值
- `allowFrom` 白名单仅在 `allowlist` 或 `pairing` 模式下生效
- **`disabled` 模式**：在 v2.3.5+ 中，会拒绝所有私聊消息（包括普通聊天），并向用户发送提示
- **群聊不受影响**：`dm.policy` 仅针对私聊消息生效，群聊 @机器人不受此配置限制

## 实现位置

### 1. 配置定义

**文件**: `src/config/schema.ts:23-27`

```typescript
const dmSchema = z.object({
    enabled: z.boolean().optional(),
    policy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
}).optional();
```

**文件**: `src/types/config.ts:5-11`

```typescript
export type WecomDmConfig = {
    policy?: 'open' | 'pairing' | 'allowlist' | 'disabled';
    allowFrom?: Array<string | number>;
};
```

### 2. 命令授权逻辑

**文件**: `src/shared/command-auth.ts`

核心函数 `resolveWecomCommandAuthorization` 处理策略判断：

```typescript
// 默认值为 pairing
const dmPolicy = (accountConfig.dm?.policy ?? "pairing") as "pairing" | "allowlist" | "open" | "disabled";

// pairing 和 allowlist 使用相同的白名单逻辑
// open 模式将 effectiveAllowFrom 设为 ["*"]
const effectiveAllowFrom = dmPolicy === "open" ? ["*"] : configAllowFrom;

// 判断发送者是否在白名单中
const senderAllowed = isWecomSenderAllowed(senderUserId, effectiveAllowFrom);
```

策略语义：
- **`open`**: 命令对所有人开放（除非更高一级的 access-groups 拒绝）
- **`allowlist` / `pairing`**: 命令需要 sender 在 allowFrom 列表中
- **`disabled`**: 拒绝所有命令执行

### 3. 频道配置适配

**文件**: `src/channel.ts:118-128`

```typescript
resolveAllowFrom: ({ cfg, accountId }) => {
    const account = resolveWecomAccount({ cfg: cfg as OpenClawConfig, accountId });
    // 优先使用 agent 配置，回退到 bot 配置
    const allowFrom = account.agent?.config.dm?.allowFrom ?? account.bot?.config.dm?.allowFrom ?? [];
    return allowFrom.map((entry) => String(entry));
},
```

### 4. Onboarding 向导

**文件**: `src/onboarding.ts:472-502`

首次配置时提供交互式选择：

```typescript
const policyChoice = await prompter.select({
    message: "请选择单聊策略：",
    options: [
        { value: "pairing", label: "配对模式", hint: "推荐：安全，未知用户需授权" },
        { value: "allowlist", label: "白名单模式", hint: "仅允许特定 UserID" },
        { value: "open", label: "开放模式", hint: "任何人可发起" },
        { value: "disabled", label: "禁用私聊", hint: "不接受私聊消息" },
    ],
    initialValue: "pairing",
});
```

### 5. 未授权命令提示

**文件**: `src/shared/command-auth.ts:76-103`

当用户发送命令但未获得授权时，返回中文提示：

```typescript
if (policy === "disabled") {
    return [
        `无权限执行命令（${scopeLabel} 已禁用：dm.policy=disabled）`,
        `触发者：${user}`,
        `管理员：${policyCmd("open")}（全放开）或 ${policyCmd("allowlist")}（白名单）`,
    ].join("\n");
}
```

## 配置路径

| 模式 | 配置路径 |
|------|----------|
| Bot | `channels.wecom.bot.dm.policy` |
| Bot 白名单 | `channels.wecom.bot.dm.allowFrom` |
| Agent | `channels.wecom.agent.dm.policy` |
| Agent 白名单 | `channels.wecom.agent.dm.allowFrom` |

## CLI 配置示例

```bash
# 设置 Bot 模式为开放
openclaw config set channels.wecom.bot.dm.policy "open"

# 设置 Bot 模式为白名单
openclaw config set channels.wecom.bot.dm.policy "allowlist"

# 设置白名单用户
openclaw config set channels.wecom.bot.dm.allowFrom '["user1","user2"]'

# 禁用私聊
openclaw config set channels.wecom.bot.dm.policy "disabled"
```

## 流程图

```
消息到达
    ↓
检查是否为命令 (shouldComputeAuth)
    ↓
读取 dm.policy 配置
    ↓
┌─────────────────────────────────────┐
│  policy = "open"                    │→ effectiveAllowFrom = ["*"]
│  policy = "allowlist"/"pairing"     │→ effectiveAllowFrom = allowFrom
│  policy = "disabled"                │→ 拒绝所有
└─────────────────────────────────────┘
    ↓
检查 sender 是否在 effectiveAllowFrom 中
    ↓
┌─────────────────────────────────────┐
│  是 → 继续处理命令                  │
│  否 → 返回未授权提示                │
└─────────────────────────────────────┘
```