# OpenClaw 企业微信（WeCom）Channel 插件

<p align="center">
  <strong>🚀 企业级双模式 AI 助手接入方案</strong>
</p>

<p align="center">
  <a href="#功能亮点">功能亮点</a> •
  <a href="#模式对比">模式对比</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#配置说明">配置说明</a> •
  <a href="#联系我">联系我</a>
</p>

---

## 🚀 全网首发 · 功能全面 —— 功能亮点

本插件提供**完整支持企业微信双模式（Bot + Agent）**的深度集成方案。相比目前其他的开源方案，我们提供企业级生产环境所需的全部特性：

| 核心特性 | 本插件 | 其他开源方案 | 优势说明 |
|:---|:---:|:---:|:---|
| 🔥 **双模式并行** | ✅ **完美支持** | ❌ 仅支持单模式 | 同时使用 Bot 的便捷与 Agent 的强大能力 |
| ⚡ **原生流式回复** | ✅ **Bot/Agent 全支持** | ❌ 伪流式/不支持 | 真实打字机效果，告别长时间转圈等待 |
| 📡 **主动消息推送** | ✅ **支持** | ❌ 仅被动回复 | 可随时通过 API 发送消息，脱离回调限制 |
| 🔐 **双协议加密** | ✅ **JSON + XML** | ⚠️ 部分支持 | 完整兼容企微新旧两种加密标准，安全无忧 |
| 📎 **全媒体处理** | ✅ **图片/语音/文件/视频** | ⚠️ 仅文本/图片 | 自动解密下载媒体文件，语音自动转文字 |
| 🎴 **交互式卡片** | ✅ **Template Card** | ❌ 不支持 | 支持按钮交互回调，打造复杂业务流 |
| 🔄 **Token 自运维** | ✅ **自动缓存刷新** | ❌ 需手工处理 | 内置 AccessToken 管理器，故障自动重试 |



<div align="center">
  <img src="https://cdn.jsdelivr.net/npm/@yanhaidao/wecom@latest/assets/01.image.jpg" width="45%" />
  <img src="https://cdn.jsdelivr.net/npm/@yanhaidao/wecom@latest/assets/02.image.jpg" width="45%" />
</div>



---

## 模式对比

###  Bot vs Agent 你该选哪个？

| 维度 | Bot 模式（智能体） | Agent 模式（自建应用） |
|:---|:---|:---|
| **接入方式** | 企微后台「智能机器人」 | 企微后台「自建应用」 |
| **回调格式** | JSON 加密 | XML 加密 |
| **回复机制** | response_url 被动回复 | API 主动发送 |
| **流式支持** | ✅ 原生 stream 刷新 | ❌ 模拟分段 |
| **主动推送** | ❌ 无法脱离回调 | ✅ 任意时机发送 |
| **媒体能力** | 受限（URL 方式） | 完整（media_id） |
| **被动回复图片** | ✅ 已实现 | ✅ 已实现 |
| **Outbound 发图片** | ❌ API 不支持 | ✅ 已实现 |
| **Outbound 发文本** | ❌ API 不支持 | ✅ 已实现 |
| **适用场景** | 快速体验、轻量对话 | 企业级部署、业务集成 |

> 💡 **推荐配置**：两种模式可同时启用！Bot 用于日常快速对话，Agent 用于主动通知和媒体发送。

---

## 快速开始

### 1. 安装插件

```bash
openclaw plugins install @yanhaidao/wecom
openclaw plugins enable wecom
```

也可以通过命令行向导快速配置：

```bash
openclaw config --section channels
```

### 2. 配置 Bot 模式（智能体）

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.bot.token "YOUR_BOT_TOKEN"
openclaw config set channels.wecom.bot.encodingAESKey "YOUR_BOT_AES_KEY"
openclaw config set channels.wecom.bot.receiveId ""
openclaw config set channels.wecom.bot.streamPlaceholderContent "正在思考..."
openclaw config set channels.wecom.bot.welcomeText "你好！我是 AI 助手"
# 不配置表示所有人可用，配置则进入白名单模式
openclaw config set channels.wecom.bot.dm.allowFrom '["user1", "user2"]' 
```

### 3. 配置 Agent 模式（自建应用，可选）

```bash
openclaw config set channels.wecom.enabled true
openclaw config set channels.wecom.agent.corpId "YOUR_CORP_ID"
openclaw config set channels.wecom.agent.corpSecret "YOUR_CORP_SECRET"
openclaw config set channels.wecom.agent.agentId 1000001
openclaw config set channels.wecom.agent.token "YOUR_CALLBACK_TOKEN"
openclaw config set channels.wecom.agent.encodingAESKey "YOUR_CALLBACK_AES_KEY"
openclaw config set channels.wecom.agent.welcomeText "欢迎使用智能助手"
openclaw config set channels.wecom.agent.dm.allowFrom '["user1", "user2"]'
```

### 4. 验证

```bash
openclaw gateway restart
openclaw channels status
```

---

## 配置说明

### 完整配置结构

```jsonc
{
  "channels": {
    "wecom": {
      "enabled": true,
      
      // Bot 模式配置（智能体）
      "bot": {
        "token": "YOUR_BOT_TOKEN",
        "encodingAESKey": "YOUR_BOT_AES_KEY",
        "receiveId": "",                        // 可选，用于解密校验
        "streamPlaceholderContent": "正在思考...",
        "welcomeText": "你好！我是 AI 助手",
        "dm": { "allowFrom": [] }               // 私聊限制
      },
      
      // Agent 模式配置（自建应用）
      "agent": {
        "corpId": "YOUR_CORP_ID",
        "corpSecret": "YOUR_CORP_SECRET",
        "agentId": 1000001,
        "token": "YOUR_CALLBACK_TOKEN",         // 企微后台「设置API接收」
        "encodingAESKey": "YOUR_CALLBACK_AES_KEY",
        "welcomeText": "欢迎使用智能助手",
        "dm": { "allowFrom": [] }
      }
    }
  }
}
```

### Webhook 路径（固定）

| 模式 | 路径 | 说明 |
|:---|:---|:---|
| Bot | `/wecom/bot` | 智能体回调 |
| Agent | `/wecom/agent` | 自建应用回调 |

### DM 策略

- **不配置 `dm.allowFrom`** → 所有人可用（默认）
- **配置 `dm.allowFrom: ["user1", "user2"]`** → 白名单模式，仅列表内用户可私聊

### 常用指令

| 指令 | 说明 | 示例 |
|:---|:---|:---|
| `/new` | 🆕 开启新会话 (重置上下文) | `/new` 或 `/new GPT-4` |
| `/reset` | 🔄 重置会话 (同 /new) | `/reset` |

---

## 企业微信接入指南

### Bot 模式（智能机器人）

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame#/manageTools)
2. 进入「安全与管理」→「管理工具」→「智能机器人」
3. 创建机器人，选择 **API 模式**
4. 填写回调 URL：`https://your-domain.com/wecom/bot`
5. 记录 Token 和 EncodingAESKey

### Agent 模式（自建应用）

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame#/apps)
2. 进入「应用管理」→「自建」→ 创建应用
3. 获取 AgentId、CorpId、Secret
4. **重要：** 进入「企业可信IP」→「配置」→ 添加你服务器的 IP 地址
5. 在应用详情中设置「接收消息 - 设置API接收」
6. 填写回调 URL：`https://your-domain.com/wecom/agent`
7. 记录回调 Token 和 EncodingAESKey

---

## 高级功能

### A2UI 交互卡片

Agent 输出 `{"template_card": ...}` 时自动渲染为交互卡片：

- ✅ 单聊场景：发送真实交互卡片
- ✅ 按钮点击：触发 `template_card_event` 回调
- ✅ 自动去重：基于 `msgid` 避免重复处理
- ⚠️ 群聊降级：自动转为文本描述

### 富媒体处理

| 类型 | Bot 模式 | Agent 模式 |
|:---|:---|:---|
| 图片 | ✅ URL 解密入模 | ✅ media_id 下载 |
| 文件 | ✅ URL 解密入模 | ✅ media_id 下载 |
| 语音 | ✅ 转文字入模 | ✅ 识别结果 + 原始音频 |
| 视频 | ❌ | ✅ media_id 下载 |

### DM 策略

- **不配置 `dm.allowFrom`** → 所有人可用（默认）
- **配置 `dm.allowFrom: ["user1", "user2"]`** → 白名单模式，仅列表内用户可私聊

---

## 联系我

微信交流群（扫码入群）：

![企业微信交流群](https://cdn.jsdelivr.net/npm/@yanhaidao/wecom@latest/assets/link-me.jpg)

维护者：YanHaidao（VX：YanHaidao）

---

## 更新日志

### 2026.2.3

- 🎉 **重大更新**：新增 Agent 模式（自建应用）支持
- ✨ 双模式并行：Bot + Agent 可同时运行
- ✨ AccessToken 自动管理：缓存 + 智能刷新
- ✨ Agent 主动推送：脱离回调限制
- ✨ XML 加解密：完整 Agent 回调支持
- 📁 代码重构：模块化解耦设计

### 2026.1.31

- 文档：补充入模与测试截图说明
- 新增文件支持
- 新增卡片支持

### 2026.1.30

- 项目更名：Clawdbot → OpenClaw
