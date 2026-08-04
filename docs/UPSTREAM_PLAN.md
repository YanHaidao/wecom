# WeCom 上下游企业支持修改计划

## 问题分析

根据企业微信文档和日志分析，问题出在**企业微信上下游的 Agent 消息发送机制**：

1. **上下游用户的 CorpID 不同**：
  - 主企业：`<PRIMARY_CORP_ID>`
  - 上下游企业：`<UPSTREAM_CORP_ID>`

2. **错误码 81013 的含义**：
   `user & party & tag all invalid` - 用户、部门、标签全部无效

3. **根本原因**：
  OpenClaw 使用主企业的 Agent (corpId=<PRIMARY_CORP_ID>, agentId=<PRIMARY_AGENT_ID>) 尝试给上下游用户发送消息，但企业微信的 Agent **只能向本企业可见成员发送消息**，上下游用户不在主企业 Agent 的可见范围内。

## 解决方案

根据企业微信文档 https://developer.work.weixin.qq.com/document/path/95816，正确的解决方案是：

### 核心逻辑

1. **检测上下游用户**：通过消息中的 `ToUserName`（CorpID）来判断
2. **获取下游企业的 access_token**：
   - 使用上游企业的 access_token 作为调用凭证
   - 调用 `corpgroup/corp/gettoken` 接口获取下游企业的 access_token
3. **使用下游企业的 access_token 发送消息**：
   - 使用下游企业的 `agentId`
   - 使用获取到的下游企业 access_token

### 获取下游企业 access_token 的接口

```
POST https://qyapi.weixin.qq.com/cgi-bin/corpgroup/corp/gettoken?access_token=ACCESS_TOKEN
{
  "corpid": "下游企业corpid",
  "business_type": 1,  // 1 表示上下游企业
  "agentid": 下游企业应用ID
}
```

**注意**：
- 需要使用上游企业的 access_token 作为调用凭证
- `business_type` 必须设置为 `1` 表示上下游企业
- 返回的 access_token 可用于调用下游企业通讯录的只读接口

### 修改模块

#### 模块 1：配置扩展（types/config.ts）

```typescript
export type WecomUpstreamCorpConfig = {
  corpId: string;
  agentId: number;
};

export type WecomAgentConfig = {
  // ... 其他配置
  /**
   * 上下游企业配置映射
   * key: 配置名称（可自定义）
   * value: 下游企业的 CorpID 和 AgentID
   */
  upstreamCorps?: Record<string, WecomUpstreamCorpConfig>;
};
```

#### 模块 2：上下游支持模块（upstream/index.ts）

- `detectUpstreamUser()`: 检测是否是上下游用户
- `createUpstreamAgentConfig()`: 创建上下游 Agent 配置
- `resolveUpstreamCorpConfig()`: 从配置中解析上下游企业配置
- `buildUpstreamAgentSessionTarget()`: 构建上下游用户的回复目标
- `parseUpstreamAgentSessionTarget()`: 解析上下游用户的回复目标

#### 模块 3：access_token 获取（transport/agent-api/core.ts）

添加 `getUpstreamAccessToken()` 函数：
- 先获取上游企业的 access_token
- 调用 `corpgroup/corp/gettoken` 接口获取下游企业的 access_token

#### 模块 4：上下游消息发送（transport/agent-api/client.ts）

添加 `sendUpstreamAgentApiText()` 和 `sendUpstreamAgentApiMedia()` 函数：
- 使用 `getUpstreamAgentApiAccessToken()` 获取下游企业的 access_token
- 使用下游企业的 `agentId` 发送消息

#### 模块 5：上下游 DeliveryService（capability/agent/upstream-delivery-service.ts）

新建 `WecomUpstreamAgentDeliveryService` 类：
- 专门用于发送消息给上下游用户
- 使用下游企业的 access_token 和 agentId

#### 模块 6：消息发送路由（outbound.ts）

- 检测 `wecom-agent-upstream:` 格式的目标
- 使用 `WecomUpstreamAgentDeliveryService` 发送消息

## 配置示例

```yaml
channels:
  wecom:
    accounts:
      <ACCOUNT_KEY>:
        agent:
          corpId: "<PRIMARY_CORP_ID>"  # 主企业 CorpID
          agentId: <PRIMARY_AGENT_ID>
          agentSecret: "<PRIMARY_AGENT_SECRET>"
          token: "<CALLBACK_TOKEN>"
          encodingAESKey: "<CALLBACK_ENCODING_AES_KEY>"
          # 上下游企业配置
          upstreamCorps:
            <UPSTREAM_KEY>:  # 自定义名称
              corpId: "<UPSTREAM_CORP_ID>"  # 下游企业 CorpID
              agentId: <UPSTREAM_AGENT_ID>  # 下游企业的 AgentID
```

## 关键实现细节

### 1. 获取下游企业 access_token

```typescript
const primaryToken = await getAccessToken(primaryAgent);
const url = `https://qyapi.weixin.qq.com/cgi-bin/corpgroup/corp/gettoken?access_token=${primaryToken}`;
const res = await wecomFetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    corpid: "<UPSTREAM_CORP_ID>",
    business_type: 1,  // 1 表示上下游企业
    agentid: <UPSTREAM_AGENT_ID>,
  }),
});
```

### 2. 发送消息

使用获取到的下游企业 access_token 和下游企业的 agentId 发送消息：

```typescript
const token = await getUpstreamAgentApiAccessToken({
  primaryAgent,
  upstreamCorpId,
  upstreamAgentId,
});
const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
const body = {
  touser: "<UPSTREAM_USER_ID>",
  msgtype: "text",
  agentid: <UPSTREAM_AGENT_ID>,
  text: { content: text },
};
```

### 3. 上下游用户检测

在消息接收时，通过比较 `ToUserName`（消息中的 CorpID）和配置的 `corpId` 来检测：

```typescript
const isUpstreamUser = messageToUserName !== primaryCorpId;
```

## 测试步骤

1. 配置上下游企业的 `corpId` 和 `agentId`
2. 让上下游用户发送消息到应用
3. 验证是否能正确接收消息
4. 验证是否能正确回复消息
5. 检查日志中的 `corpId` 和 `agentId` 是否正确

## 参考资料

- 企业微信上下游概述：https://developer.work.weixin.qq.com/document/path/97213
- 获取下游企业 access_token：https://developer.work.weixin.qq.com/document/path/95816
