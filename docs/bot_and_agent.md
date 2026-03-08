# Bot 与 Agent 双模架构分析

本文档详细分析 WeCom 插件中 Bot（智能体）和 Agent（自建应用）两种模式的区别，以及双模融合的实现机制。

## 概念对比

| 维度 | Bot（智能体） | Agent（自建应用） |
|------|---------------|-------------------|
| **WeCom 类型** | 智能机器人 | 自建应用 |
| **回调格式** | JSON | XML |
| **发送消息** | 流式响应（被动） | API 主动发送 |
| **媒体支持** | 仅文本、图片 | 支持所有文件类型 |
| **响应延迟** | 低（流式） | 较高（需 API 调用） |
| **超时限制** | 6 分钟窗口 | 无限制 |
| **群聊消息** | ✅ 支持（可接收群聊@消息） | ❌ 不支持（企微无群聊回调） |

## 配置结构

### Bot 配置 (WecomBotConfig)

**文件**: `src/types/config.ts:47-68`

```typescript
export type WecomBotConfig = {
    aibotid?: string;           // 智能机器人 ID
    token: string;              // 回调 Token
    encodingAESKey: string;     // 回调加密密钥
    botIds?: string[];          // BotId 列表（可选）
    receiveId?: string;         // 接收者 ID
    streamPlaceholderContent?: string;  // 流式占位符
    welcomeText?: string;       // 欢迎语
    dm?: WecomDmConfig;        // 单聊策略
};
```

### Agent 配置 (WecomAgentConfig)

**文件**: `src/types/config.ts:74-88`

```typescript
export type WecomAgentConfig = {
    corpId: string;             // 企业 ID
    corpSecret: string;         // 应用 Secret
    agentId?: number | string; // 应用 ID（关键！）
    token: string;              // 回调 Token
    encodingAESKey: string;     // 回调加密密钥
    welcomeText?: string;       // 欢迎语
    dm?: WecomDmConfig;        // 单聊策略
};
```

## 配置路径

### Legacy 模式（单账号）

```yaml
channels:
  wecom:
    bot:
      token: "xxx"
      encodingAESKey: "xxx"
    agent:
      corpId: "yyy"
      corpSecret: "zzz"
      agentId: 1000001
```

### Matrix 模式（多账号）

```yaml
channels:
  wecom:
    accounts:
      company-a:
        name: "公司A"
        bot:
          token: "xxx"
          encodingAESKey: "xxx"
        agent:
          corpId: "yyy"
          corpSecret: "zzz"
          agentId: 1000001
```

## agentId 的来源与获取

`agentId` 是企业在微信后台创建自建应用时分配的**应用 ID**。

### 获取方式

1. **登录企业微信管理后台** (https://work.weixin.qq.com/wework_admin)
2. 进入 **应用管理** → **自建应用**
3. 点击进入应用详情，查看 **AgentId**（也称 `应用ID`）

### 配置解析

**文件**: `src/config/accounts.ts:64-69`

```typescript
function resolveAgentAccount(accountId: string, config: WecomAgentConfig, network?: WecomNetworkConfig): ResolvedAgentAccount {
    const agentIdRaw = config.agentId;
    const agentId = agentIdRaw == null
        ? undefined
        : (typeof agentIdRaw === "number" ? agentIdRaw : Number(agentIdRaw));
    const normalizedAgentId = Number.isFinite(agentId) ? agentId : undefined;

    return {
        accountId,
        enabled: true,
        configured: Boolean(
            config.corpId && config.corpSecret &&
            config.token && config.encodingAESKey
        ),
        corpId: config.corpId,
        corpSecret: config.corpSecret,
        agentId: normalizedAgentId,  // 解析后的数值
        // ...
    };
}
```

### agentId 的作用

1. **标识自建应用**：每个自建应用有唯一的 agentId
2. **消息发送**：调用 WeCom API 时需要指定 agentId
3. **账号冲突检测**：同一 corpId + agentId 组合不能重复配置

```typescript
// 检测重复配置
const key = `${normalizeDuplicateKey(corpId)}:${agentId}`;
if (owner && owner !== accountId) {
    conflicts.set(accountId, formatAgentIdConflict({ ... }));
}
```

## 双模融合实现

### 1. HTTP 路由分发

**文件**: `index.ts:27-35`

```typescript
const routes = ["/plugins/wecom", "/wecom"];
for (const path of routes) {
    api.registerHttpRoute({
        path,
        handler: handleWecomWebhookRequest,
        auth: "plugin",
        match: "prefix",
    });
}
```

所有请求先进入 `handleWecomWebhookRequest`，再根据路径分发：

**文件**: `src/monitor.ts:2165-2171`

```typescript
const isAgentPathCandidate =
    path === WEBHOOK_PATHS.AGENT ||           // /wecom/agent
    path === WEBHOOK_PATHS.AGENT_PLUGIN ||     // /plugins/wecom/agent
    path.startsWith(`${WEBHOOK_PATHS.AGENT}/`) ||
    path.startsWith(`${WEBHOOK_PATHS.AGENT_PLUGIN}/`);

if (matchedAgentTargets.length > 0 || isAgentPathCandidate) {
    // 分发到 Agent 处理器
} else {
    // 分发到 Bot 处理器
}
```

### 2. Webhook 路径常量

**文件**: `src/types/constants.ts`

```typescript
export const WEBHOOK_PATHS = {
    BOT: "/wecom",                // 兼容旧版
    BOT_ALT: "/wecom/bot",        // 兼容旧版
    AGENT: "/wecom/agent",       // 兼容旧版
    BOT_PLUGIN: "/plugins/wecom/bot",    // 推荐
    AGENT_PLUGIN: "/plugins/wecom/agent", // 推荐
};
```

### 3. Bot 模式的消息处理

**文件**: `src/monitor.ts` - 核心函数 `processWecomBotInbound`

- 接收 JSON 格式的回调消息
- 使用流式响应 (`streamStore`)
- 支持文本和图片（Base64）
- 有 6 分钟超时限制

```typescript
// 流式状态管理
const BOT_WINDOW_MS = 6 * 60 * 1000;  // 6 分钟
const BOT_SWITCH_MARGIN_MS = 30 * 1000; // 提前 30 秒切换
```

### 4. Agent 模式的回调处理

**文件**: `src/agent/handler.ts` - 函数 `handleWecomAgentWebhook`

- 接收 XML 格式的回调消息
- 使用 `api-client.ts` 调用 WeCom API 发送消息
- 支持所有文件类型
- 无超时限制

### 5. 双模 Fallback 机制

当 Bot 模式无法处理时，自动切换到 Agent 模式：

**文件**: `src/monitor.ts`

#### Fallback 触发条件

1. **超时 fallback**（接近 6 分钟）
   ```typescript
   // monitor.ts:1774-1795
   const now = Date.now();
   const deadline = current.createdAt + BOT_WINDOW_MS;
   const switchAt = deadline - BOT_SWITCH_MARGIN_MS;
   if (nearTimeout) {
       // 切换到 Agent 私信发送
   }
   ```

2. **非图片文件 fallback**
   ```typescript
   // monitor.ts:1838-1848
   if (agentCfg && !alreadySent && current.userId) {
       await sendAgentDmMedia({ ... });
   }
   ```

3. **图片发送失败 fallback**
   ```typescript
   // monitor.ts:1296-1308
   const agentCfg = resolveAgentAccountOrUndefined(config, account.accountId);
   // 切换到 Agent 私信发送
   ```

#### Fallback 流程图

```
Bot 会话
    │
    ├─[超时 6分钟前]─→ 正常流式响应
    │
    ├─[超时 接近6分钟]─→ Bot 结束流 → Agent DM 发送剩余内容
    │
    ├─[图片读取失败]─→ Agent DM 发送图片
    │
    └─[非图片文件]─→ Agent DM 发送文件 + Bot 提示用户
```

## Bindings 与路由

### accountId 的作用

`accountId` 是 WeCom 账号在 OpenClaw 中的唯一标识，用于与 `bindings.match.accountId` 对齐。

**文件**: `src/types/config.ts:115-117`

```typescript
/**
 * accountId 用于与 OpenClaw `bindings[].match.accountId` 对齐，
 * 从而把不同 WeCom 账号路由到不同 OpenClaw agent。
 */
accounts?: Record<string, WecomAccountConfig>;
```

### Bindings 配置示例

```yaml
agents:
  list:
    - id: "wecom-bot-company-a"
      bindings:
        - agentId: "your-openclaw-agent-id"
          match:
            channel: "wecom"
            accountId: "company-a"  # 对应 channels.wecom.accounts.company-a
```

### 路由拒绝逻辑

**文件**: `src/agent/handler.ts:445-459`

当 Agent 回调到达但没有匹配的 bindings 时：

```typescript
if (shouldRejectWecomDefaultRoute({ cfg: config, matchedBy: route.matchedBy, useDynamicAgent })) {
    const prompt =
        `当前账号（${agent.accountId}）未绑定 OpenClaw Agent，已拒绝回退到默认主智能体。` +
        `请在 bindings 中添加：{"agentId":"你的Agent","match":{"channel":"wecom","accountId":"${agent.accountId}"}}`;
    // 发送提示消息给用户
}
```

## 账号解析流程

**文件**: `src/config/accounts.ts`

```
resolveWecomAccounts(cfg)
    │
    ├─ detectMode(config) → "legacy" | "matrix" | "disabled"
    │
    ├─ [Legacy 模式]
    │   └─ resolveLegacyAccounts()
    │       └─ 一个默认账号 (accountId = "default")
    │           ├─ bot: resolveBotAccount()
    │           └─ agent: resolveAgentAccount()
    │
    └─ [Matrix 模式]
        └─ resolveMatrixAccounts()
            └─ 多个账号 (accounts 键值)
                └─ 每个账号包含 bot + agent
```

## 关键设计原则

1. **Bot 优先**：正常对话使用 Bot，享受流式响应体验
2. **Agent 兜底**：当 Bot 无法处理（超时/文件）时自动切换
3. **账号独立**：Bot 和 Agent 作为同一账号的两个能力，可以单独启用
4. **路由对齐**：accountId 与 OpenClaw bindings.match.accountId 一致

## 配置检查清单

- [ ] Bot 模式：配置 `token` + `encodingAESKey`
- [ ] Agent 模式：配置 `corpId` + `corpSecret` + `agentId` + `token` + `encodingAESKey`
- [ ] Matrix 多账号：每个账号设置唯一的 `accountId`
- [ ] Bindings：在 `agents.list` 中添加对应的 bindings 配置

## 群聊能力说明

### Bot 群聊能力

Bot（智能机器人）**可以加入群聊**，并且能够接收群聊中被 @ 的消息。

- 接收消息类型：文本、引用消息
- 发送消息：在群内直接回复（文本/图片/Markdown）
- 回调路径：`/plugins/wecom/bot/{accountId}`

### Agent 群聊能力

Agent（自建应用）**虽然可以加入群聊**，但企业微信**不会推送群聊消息的回调**。

- 群聊消息回调：❌ 不支持（企微官方接口限制）
- 仅支持：点击应用卡片事件、用户从群聊打开应用等事件回调
- 主动推送：可以主动向群聊发送消息（需使用 `group:{chatId}` 目标）

### 设计原因

这是因为企业微信的消息回调机制：
- Bot（智能机器人）：企微会推送群聊 @消息的回调
- Agent（自建应用）：企微仅推送私聊消息和部分事件回调，不推送群聊消息