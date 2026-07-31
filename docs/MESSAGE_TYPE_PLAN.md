# WeCom 消息格式方案

## 已交付：按配置发送 markdown

企业微信的文本消息可以按 markdown 渲染，由**账号级或渠道级配置**决定，Agent 无需感知。

### 配置

```yaml
channels:
  wecom:
    accounts:
      blue:
        markdown:
          format: markdown   # text（默认）| markdown
```

也可以配在渠道级 `channels.wecom.markdown.format` 作为所有账号的默认。优先级：账号级 > 渠道级 > 默认 `text`。不配就与本功能之前的行为完全一致。

### 设计依据：格式是渠道能力，不是逐条选择

OpenClaw 的既有模型（`docs/concepts/markdown-formatting.md`）是：Agent 只输出 markdown 文本，core 解析成 IR，各渠道 renderer 渲染成该平台原生标记。Slack 渲染 mrkdwn、Telegram 渲染 HTML、Discord 走纯文本——都不需要 Agent 每条选，配置粒度是渠道级与账号级。

企业微信对齐这个模型。这也解释了为什么 `ChannelOutboundContext` 有 `formatting?: OutboundDeliveryFormattingOptions` 而没有 `channelData`：core 的 `createChannelOutboundContextBase()` 构造投递上下文时字段是固定的（`cfg / to / text / accountId / replyToId / threadId / mediaAccess / silent / formatting`），Agent 的普通回复文本里也没有 directive 能写入 `channelData`（`parseInlineDirectives` 只认 think/verbose/model/queue 等固定指令）。所以普通对话回复只能靠配置——这不是缺陷，本就该如此。

### 覆盖的四条发送路径

| 路径 | 入口 | 格式解析处 |
| --- | --- | --- |
| Agent 回调回复 | `agent/handler.ts` | 自己调 `resolveWecomMarkdownFormat` |
| Agent API 主动发送 | `outbound.ts` → `WecomAgentDeliveryService` | `outbound.sendText` 解析后传入 |
| 上下游企业 | `outbound.ts` → `WecomUpstreamAgentDeliveryService` | 同上 |
| Bot 超时兜底私信 | `capability/bot/fallback-delivery.ts` | 自己调 `resolveWecomMarkdownFormat` |

前后两条不经过 `wecomOutbound`，所以各自解析配置——这是四处而非一处的原因。

**Bot WS 通道不在此列**：`@wecom/aibot-node-sdk` 主动发送的消息体联合类型只有 `SendMarkdownMsgBody | SendTemplateCardMsgBody | SendMediaMsgBody`，没有 `text`。"发纯文本"这件事在该协议层不存在，该通道恒按 markdown 投递，`markdown.format` 对它不适用。

### markdown 转换与分片顺序

`prepareWecomMarkdownChunks()`（`src/config/markdown.ts`）先整体转换再分片：

```typescript
chunkMarkdownText(toWeComMarkdownV2(text), limit)
```

顺序不能颠倒。`toWeComMarkdownV2` 不保证收缩文本——实测图片密集内容 1179 → 1239 字符（约 +5%），先分片再转换会让超出上限的部分被 `truncateSafely` 静默吃掉。

分片用 SDK 的 `chunkMarkdownText` 而非 `chunkText`：定长切分会把 `**bold**`、`[text](url)` 从中间劈开，两半都渲染不出来。`chunkMarkdownText` 按行与代码围栏边界切，且每片重开围栏。

**纯文本路径未改动**：各发送点保持各自既有的分片方式（`handler.ts` 定长 600、其余走 `chunkText` 2048）。默认配置是纯文本，所以升级不改变任何现有账号的表现。

### 涉及文件

- `src/config/markdown.ts`（新）：`resolveWecomMarkdownFormat`、`prepareWecomMarkdownChunks`、`normalizeWecomMarkdownFormat`
- `src/config/schema.ts`：`MarkdownConfig` 挂到 `AccountConfig.markdown` 与 `WecomConfigInput.markdown`
- `src/config/index.ts`：re-export
- `src/transport/agent-api/core.ts`：`sendMarkdown()`，走 `message/send` 的 `msgtype: "markdown"`
- `src/transport/agent-api/client.ts`：`sendUpstreamAgentApiMarkdown()`
- `src/transport/agent-api/{reply,delivery,upstream-reply,upstream-delivery}.ts`：markdown 转发层
- `src/capability/agent/{delivery-service,upstream-delivery-service}.ts`：按 `format` 分派
- `src/capability/bot/fallback-delivery.ts` + `stream-finalizer.ts`：兜底私信传 `cfg`
- `src/agent/handler.ts`：回调回复路径

### 顺带修掉的

- **upstream 媒体丢 msgid**：`deliveryService.sendMedia()` 返回值原先被丢弃，`messageId` 恒为 `upstream-agent-media-${Date.now()}`。另外三条路径都已透传真实 msgid，只有这条漏了
- **`client.ts` 里手抄的 POST 骨架**：upstream media 有一百多行与 text 重复的 token/URL/校验逻辑，抽成 `dispatchUpstreamAgentApi`；`core.ts` 同理抽成 `dispatchAgentApi`

---

## 待办

### P1：Agent 逐条覆盖格式（`wecomFormat`）

让 Agent 在账号配了 `markdown` 时对单条消息改发纯文本，或反之。

做法（曾实现后回退，因为它与"按配置发送"是两个独立功能，混在一个改动里评审不清）：

1. `actions.prepareSendPayload()`：读 `ctx.params.wecomFormat`，翻译成 `payload.channelData.wecom.format`；没传返回 `undefined`
2. `outbound.sendPayload()`：从 `payload.channelData.wecom.format` 读回，用 SDK 的 `sendPayloadWithChunkedTextAndMedia()` 委托给 `sendText`
3. `describeMessageTool()` 的 schema contribution 用 `optionalStringEnum`

要点：
- **不要用 `handleAction` 接管 send**。SDK 文档（`plugins/sdk-channel-plugins.md`）明确说那只是"payload 无法序列化重试"时的兼容回退。用 `prepareSendPayload` 才能保留 core 的持久化、重试、恢复、ack、目标校验、分片、多媒体
- schema `visibility` 需要 `"all-configured"` 而非 `"current-channel"`：按 `resolveChannelMessageToolSchemaProperties()` 的合并规则，后者只在当前会话渠道就是 wecom 时注入属性，Agent 从 CLI 或其他渠道往 WeCom 发消息时看不到这个参数。代价是所有配了 wecom 的会话都会在 `message` schema 里看到它
- 不要向 Agent 暴露原始 `msgtype`，避免生成非法或越权的企微 payload
- `core.sendPayload` 只在 payload 带 `channelData` / `presentation` / `interactive` / `audioAsVoice` 时才会被调用（见 `deliver.ts` 的分支条件）

### P1：`unlicenseduser` 的处理方式待确认

`core.ts` / `client.ts` 现在只对 `invaliduser` / `invalidparty` / `invalidtag` 抛错。企微在部分收件人无互通许可时会返回 `unlicenseduser`，**同时把消息投递给了其余人**。

改成抛错在逻辑上与既有的 `invaliduser` 处理一致，但那是对现有可用发送的行为变更（原本算成功）。需要单独确认后再动。

### P2：`auto` 格式（按内容嗅探）

含 markdown 语法就走 markdown，否则纯文本。是 `resolveWecomMarkdownFormat` 之上的一层策略，不影响现有配置语义。曾实现为"等同 text"的占位值，因为没有实际嗅探逻辑而移除。

### P2：回执携带真实投递格式

`OutboundDeliveryResult.meta` 可以带 `{ transport, deliveredFormat }`，但**目前没有消费者**：core 的 `toMessageSendResult()` 只取 `receipt` 和 `messageId`，`formatOutboundDeliverySummary()` 只渲染 messageId，两处都不读 `meta`。Agent 拿不到。若要让 Agent 感知实际格式，需要另找通道。

### P2：卡片类消息

`textcard` / `template_card` 作为独立 action，不混进文本格式选择。

### P3：媒体类型显式选择（`wecomMediaType`）、`news` / `mpnews` / `miniprogram_notice`

---

## 群会话（chatId）：这条路不存在

企业微信自建应用的接收消息回调 XML **不含 `ChatId` 字段**（[消息格式](https://developer.work.weixin.qq.com/document/path/90239)：入站六种消息类型的字段只有 `ToUserName` / `FromUserName` / `CreateTime` / `MsgType` / `Content` / `MsgId` / `AgentID`，发送方恒为成员 UserID）。appchat 会话只出不进：`appchat/create` 由应用建群并持有 chatid，没有把应用加入用户既有群聊的接口。群聊场景由 Bot（智能机器人）承担，走 bot-ws / bot-webhook，与 Agent API 无关。

因此 `extractChatId()` 读到的 `msg.ChatId` 恒为 undefined，`sendMarkdown()` 里任何 chatId 分支都不可达。`sendMarkdown()` / `sendUpstreamAgentApiMarkdown()` 保留 `chatId?: string` 参数只为兼容调用方的展开写法（`handler.ts` 传 `...effectiveReplyTarget`），函数体不使用它。

`handler.ts` 的 `isGroup` 分支、`sendText()` / `sendMedia()` 的 `useChat` 分支同属这类死路，均为既有代码，本次未动。

---

## 能力清单

| 企微 `msgtype` | Agent API | Bot WS | 当前状态 | 优先级 |
| --- | --- | --- | --- | --- |
| `text` | 支持 | **协议不支持** | 默认路径 | P0 |
| `markdown` | 支持（仅 message/send） | 支持 | **已交付** | P0 |
| `image` | 支持 | 支持 | 已支持，按 MIME 推断 | P0 |
| `file` | 支持 | 支持 | 已支持 | P0 |
| `voice` | 支持 | 支持 | 链路已通，待专项验收 | P1 |
| `video` | 支持 | 支持 | 链路已通，待专项验收 | P1 |
| `markdown` on `appchat` | 路径不存在（回调无 ChatId） | N/A | 不适用 | — |
| `textcard` | 支持 | 不支持 | 未支持 | P2 |
| `template_card` | 支持 | 支持 | 仅 Bot 被动回复有特例 | P2 |
| `news` | 支持 | 不支持 | 未支持 | P3 |
| `mpnews` | 支持 | 不支持 | 未支持 | P3 |
| `miniprogram_notice` | 支持 | 不支持 | 未支持 | P3 |

---

## 依赖版本

`package.json` 的 devDependency 锁在 `openclaw@2026.7.1`。两个升级后的注意点：

- `typebox` 不再提升到顶层 `node_modules`（现在嵌在 `openclaw/node_modules/`），直接 import 会编译失败 → 用 SDK 的 `optionalStringEnum()`
- plugin-sdk 的 `.d.ts` 目录结构从 `dist/plugin-sdk/src/...` 变成扁平的 `dist/plugin-sdk/...`
- `chunkMarkdownText` 从 `openclaw/plugin-sdk/reply-runtime` 导出，**不在** `reply-chunking`（后者只有 `chunkText` / `chunkTextWithMode` / `chunkMarkdownTextWithMode`）

peerDependency 仍是 `^2026.7.0`，运行时是 `2026.7.1-2`（带构建后缀，npm 上没有该确切版本）。若上游发布带后缀的版本需要再对齐。

---

## 已知遗留（与本功能无关的既有问题）

- `src/monitor.active.test.ts` 的两个用例超时：测试用 fake timers，但 `useActiveReplyOnce`（`src/transport/bot-webhook/active-reply.ts:19`）里有真实 `setTimeout(1000)`，永远不会被推进
- `src/channel.config.test.ts` 的两个冲突守卫用例失败：测试用扁平的 `bot: { token, encodingAESKey }`，而 `resolveBotAccount`（`src/config/accounts.ts:38`）读的是 `bot.webhook.token`
- `src/channel.lifecycle.test.ts` / `src/onboarding.test.ts` 无法加载：import 的是仓库外路径（`../../test-utils/`、`../../../src/channels/`）

---

## 参考

- 企业微信发送应用消息：https://developer.work.weixin.qq.com/document/path/90236
- 企业微信接收消息格式：https://developer.work.weixin.qq.com/document/path/90239
- OpenClaw Channel Plugin SDK：https://docs.openclaw.ai/plugins/sdk-channel-plugins
- OpenClaw markdown 格式化管线：https://docs.openclaw.ai/concepts/markdown-formatting
- OpenClaw Channel outbound API：https://docs.openclaw.ai/plugins/sdk-channel-outbound
