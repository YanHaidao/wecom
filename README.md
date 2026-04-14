# OpenClaw 企业微信（WeCom）Channel 插件

> 📚 文档站入口（用于 GitHub Pages）：[`docs/index.md`](./docs/index.md)

<p align="center">
  <img src="https://img.shields.io/badge/Original%20Project-YanHaidao-orange?style=for-the-badge&logo=github" alt="Original Project" />
  <img src="https://img.shields.io/badge/License-ISC-blue?style=for-the-badge" alt="License" />
</p>

> [!WARNING]
> **原创声明**：本项目涉及的“多账号隔离与矩阵路由架构”、“Bot+Agent双模融合架构”、“长任务超时接力逻辑”及“全自动媒体流转接”等核心设计均为作者 **YanHaidao** 独立思考与实践的原创成果。
> 欢迎技术交流与合规引用，但严禁任何不经授权的“功能像素级抄袭”或删除原作者署名的代码搬运行为。

<p align="center">
  <strong>🚀 企业级多模式 AI 助手接入方案（统一运行时架构）</strong>
</p>

---

## 💡 核心价值：为什么团队会真正选择这个插件？

企业真正需要的，不是“把一个模型接进企业微信”，而是让企业微信变成一个**能长期工作的 AI 协作入口**。

大多数团队最终只关心五件事：

- 能不能先低门槛接起来，而不是先做一轮重部署
- 多人同时使用时，会不会串上下文、串身份、串会话
- 长任务会不会因为长连接窗口太短而白跑
- 能不能既有实时对话体验，又能做正式推送和稳定投递
- AI 能不能真正进入文档、日程、会议、待办、通讯录这些协作层，而不只是停留在聊天框

常见方案通常会很快碰到边界：

- **只用 Bot WS**：接得快、聊得顺，但会受到单连接、心跳保活、会话边界和组织级广播能力的限制
- **只用 Agent**：能力强、治理清晰，但部署门槛更高，对话体验不如 Bot WS 丝滑
- **只选单一路径**：团队最后往往被迫在“体验”和“能力”之间二选一

本插件的价值，就在于把这些原本互相冲突的目标，尽量同时成立。

### 您真正会得到什么？

1. **多人共用一个入口，但上下文不会串**
   - **问题本质**：企业里真正难的不是“接入一个机器人”，而是让几十上百个人同时使用时，仍然保持每个人的上下文隔离。
   - **插件做法**：按 `(底层账号 + 部门/群组/人员)` 动态切分运行上下文和 Agent 实例。
   - **用户收益**：同一个企业微信入口可以承接多人并发使用，而不会出现“张三的问题让李四接上回答”的串流灾难。

2. **长任务不白跑，回复不轻易丢**
   - **问题本质**：企业微信长连接的响应窗口很短，而推理模型的思考时间往往很长。
   - **插件做法**：先保活，再流式推进；必要时走备用投递路径，把最终结果交付出去。
   - **用户收益**：更敢把复杂任务、长文本分析、报告生成交给 AI，而不是每次都担心“算完了却发不回来”。

3. **实时对话体验和正式投递能力，不用二选一**
   - **问题本质**：实时聊天和组织级推送，往往不是同一条技术路径最擅长的事。
   - **插件做法**：会话内实时交互、流式回复、异步追发优先走 `Bot WS`；组织级广播、冷启动触达、正式通知由 `Agent` 兜底。
   - **用户收益**：日常使用时体验像聊天助手，正式落地时又有企业应用该有的稳定性和控制力。

4. **AI 不只会聊天，还能进入企业微信协作层**
   - **问题本质**：如果 AI 只能回消息，信息最终还是散落在聊天流里，业务并没有真正被推进。
   - **插件做法**：把企业微信原生协作能力按两条能力平面接入 OpenClaw。
   - **用户收益**：AI 不仅能回答问题，还能真正参与文档、日程、会议、待办和通讯录相关工作。

5. **小团队能低门槛上手，大团队也能正式上线**
   - **问题本质**：小团队怕折腾，大团队怕失控。
   - **插件做法**：`Bot WS` 适合快速启用，`Agent` 适合正式治理，两者可以并存。
   - **用户收益**：您不用在“今天先跑起来”和“将来能不能正规化”之间做破坏性迁移。

---

## 📊 为什么不是只选 Bot，或者只选 Agent？

从用户视角看，差别不在于协议名词，而在于**你要解决的是什么问题**。

| 你真正关心的事 | 🤖 Bot 模式 (WebSocket) | 🧩 Agent 模式 (自建应用 API) | ✨ 本插件的做法 |
|:---|:---|:---|:---|
| **先跑起来的速度** | ✅ 快，无需固定公网 IP | ❌ 较重，需要正式应用配置 | ✅ 先用 Bot 起步，后续平滑补 Agent |
| **实时聊天体验** | ✅ 最强，天然适合低延迟和流式回复 | ⚠️ 能收能发，但不是最佳对话入口 | ✅ 默认把实时交互交给 Bot |
| **异步结果回推** | ✅ 可以，适合已建立会话内追发 | ✅ 可以 | ✅ 会话内追发优先 Bot，必要时 Agent 兜底 |
| **组织级广播与冷启动触达** | ⚠️ 受会话边界约束 | ✅ 更适合 | ✅ 正式通知和广播走 Agent |
| **企业微信协作能力** | ✅ 适合个人身份能力入口 | ✅ 适合应用身份能力入口 | ✅ 两种身份平面都兼容 |
| **适合谁** | 想快速上线、重视实时体验的团队 | 需要正式治理、自动化和组织级能力的团队 | 想同时要“体验”和“能力”的团队 |

> **建议理解方式：**
> - 如果您最在意的是“先接起来、先用起来、先聊顺”，优先上 `Bot WS`
> - 如果您最在意的是“正式部署、组织级能力、自动化治理”，补齐 `Agent`
> - 如果您真正想把 AI 在企业微信里长期用下去，最终往往需要两者并存

---

## 🧩 企业微信协作能力：为什么这件事比“能聊天”更重要？

很多企业微信 AI 机器人，本质上只是把答案发回聊天框。  
真正有价值的，是让 AI 进入您**已经在工作的地方**。

在本插件里，企业微信的**文档、日程、会议、待办、通讯录**等能力，不再只是外围说明，而是被接成了可以实际调用的协作平面。

### 1. Bot WS 协作模式：适合小团队的个人身份入口

根据企业微信最新开放说明，面向 **5 人及以下的小微企业**，`Bot WS` 模式现已开放以**用户个人身份**调用部分企业微信协作能力。

在本插件里，这条链路以 `wecom_mcp` 的方式挂载，只在 **WeCom Bot WS 会话** 中可用：

- 能力入口：`wecom_mcp`
- 典型能力品类：`doc`、`meeting`、`todo`、`contact`
- 触发条件：当前会话必须来自 `Bot WS`
- 更适合的场景：个人身份读写文档、查询通讯录、处理待办、操作会议等轻量协作场景

它的价值在于：

- **门槛低**：无需先走完整的自建应用接入流程
- **身份自然**：更贴近当前聊天用户自己的协作上下文
- **启动快**：对小团队尤其友好

它的边界也要明确：

- 依赖 `Bot WS` 会话存在
- 主动推送仍然以**已建立会话**为前提
- 实际开放范围以企业微信后台可见权限为准

### 2. Agent 协作模式：适合正式落地的应用身份入口

`Agent` 模式走的是**自建应用 API** 平面，更适合企业级稳定自动化与组织级治理。

在本插件里，当前内置的协作工具主要包括：

- `wecom_doc`：文档、表格、权限、分享可用性诊断等
- `wecom_calendar`：日历、日程、参与人、回执、默认日历等

它更适合：

- 把协作能力放进正式企业应用权限体系
- 与定时任务、异步流程、正式投递联动
- 面向组织对象做更稳定的自动化操作

### 3. 这两条能力链在插件里已经实际接通

当前插件已经把这两条协作链路都注册进来：

- `wecom_mcp`：仅在 `Bot WS` 会话中暴露
- `wecom_doc`：仅在 `Agent` 会话中暴露
- `wecom_calendar`：仅在 `Agent` 会话中暴露

也就是说，您拿到的不是“一个只能聊天的企微插件”，而是：

- 一条适合实时对话和个人协作的入口
- 一条适合正式应用和组织自动化的入口

### 4. 授权方式

请按所选平面分别授权：

- **Bot WS 模式授权**：前往企业微信管理后台 👉「工作台 - 智能机器人」，找到对应机器人，点击编辑，在「可使用权限」处勾选文档、日程、会议、待办、通讯录等对应权限。
- **Agent 模式授权**：前往企业微信管理后台 👉「工作台 - 协作 - 文档 / 日程 / 会议等」，将您的自建应用加入“可调用接口的应用”。

一句话理解：

- **Bot WS** 更像“当前聊天用户的实时协作入口”
- **Agent** 更像“企业正式应用身份下的自动化执行入口”

两者同时配置后，您既能拿到顺滑的实时交互，也能拿到企业级可治理的协作能力。

---

## 📋 最近更新 (Changelog摘要)

> 项目保持高频迭代，全面对齐甚至超越企业真实业务诉求。
> **为保持精简，以下仅展示近期 5 次重要更新，完整历史版本（含全部 `v2.2.x`）请前往 [changelog/ 目录](./changelog/) 查阅。**

#### 📌 v2.4.12（2026-04-12）
- **[新增优化] 自建应用菜单事件可路由到本地脚本** ⚙️ 企业微信自建应用收到 `click` 等 `event` 事件后，现在可以按 `eventType`、`eventKey`、`changeType` 等规则命中本地 `Node.js` / `Python` 脚本，不再只能一律进入默认 Agent 流程。
- **[新增优化] 脚本既能直接回复，也能继续链到 Agent** 🔀 脚本返回结果里可以控制是否继续进入 AI 流程，适合把“菜单先走固定逻辑，复杂问题再交给 Agent”的模式真正落地。
- **[新增能力] 上下游企业现在可通过 Agent 渠道互通** 🏢 如果你的自建应用已经共享给上下游企业，现在插件可以根据下游 `CorpID` 和 `agent.upstreamCorps` 把回复准确发回对应企业，图片和语音等常见媒体链路也一起补稳了。
- **[重要修复] Webhook 入站文件不再被固定 5MB 限制误拦** 📎 之前有些企业微信附件虽然在实际配置允许范围内，但进入会话工作区前仍会被旧的固定阈值挡住。这一版已经改成按当前 WeCom 配置解析后的大小限制执行，入站文件接入更稳。

#### 📌 v2.3.27（2026-03-27）
- **[重要修复] `channel add` 重新支持 WeCom guided setup** 🧭 之前有些环境下，`wecom` 虽然已经安装，却仍会在 OpenClaw 里显示成 “does not support guided setup yet”，导致无法直接通过交互式向导添加。现在插件已经对齐 OpenClaw 当前的 `setupWizard` 接口，`openclaw channels add` 会重新正常识别和进入配置流程。
- **[重要修复] 修复 `installedCatalogById is not defined`** 🔧 部分用户在渠道添加或选择阶段会直接遇到 `ReferenceError: installedCatalogById is not defined`，表现上像是“选了渠道就报错”或“添加流程突然失效”。这一版已经修复对应的目录访问逻辑，添加流程恢复稳定。
- **[升级兼容] 清理 OpenClaw 新版下失效的 SDK 旧入口** 📦 这次同步迁移了 `wecom` 插件里几处已经不再建议继续从 `openclaw/plugin-sdk` 根入口直接拿的旧接口，重点覆盖工具上下文、outbound 适配器和 Bot WS 媒体发送链路，升级 OpenClaw 后更不容易再出现“有的地方能跑、有的地方直接炸”的兼容问题。

#### 📌 v2.3.26（2026-03-26）
- **[重要修复] 升级 OpenClaw 后不再乱报错** 🔧 修复了新版 OpenClaw 下 `wecom` 插件容易出现的 `is not a function` 一类启动/运行错误。
- **[回复更稳] Agent 和 Bot WS 不再乱串** ↔️ 现在是谁收到消息，就尽量由谁来回复，不再容易出现“在 Agent 里说话，结果 Bot WS 回你”的情况。
- **[体验修复] Bot WS 发图后不再多冒一条 `Done...`** 🖼 之前常见表现是：`正在思考` -> 图片 -> 又多一条完成提示。现在最终收尾会尽量接回原来的回复链路。
- **[占位符修复] 不会一直卡在“正在思考...”** ⏳ 如果图片或文本已经发出去了，占位符会更自然地结束，不会继续无意义地刷屏。

#### 📌 v2.3.19（2026-03-19）
- **[重要修复] Bot WS 现在也真正走 `dynamicAgents`** 🧭 之前同样开启动态路由时，不同消息链路的行为并不完全一致：Webhook / Agent 能按用户、群聊隔离，Bot WebSocket 却可能重新落回主 Agent。现在 WS 运行时也执行同样的动态路由逻辑，会话隔离终于统一了。
- **[配置统一] 媒体大小开始优先跟随 OpenClaw 标准 `mediaMaxMb`** 📦 之前 WeCom 插件更偏向读取自己的 `media.maxBytes`，用户改了 OpenClaw 主配置却可能感觉“改了没生效”。现在插件优先支持 `channels.wecom.mediaMaxMb`，并支持 `channels.wecom.accounts.<accountId>.mediaMaxMb` 做账号级覆盖；旧配置仍兼容，但只作为兜底。
- **[体验修复] 常见本地目录文件现在更符合直觉地可发送** 🖼 过去本地媒体白名单更偏向 OpenClaw 自己目录，导致像 `Downloads`、`Desktop`、`Pictures` 里的图片明明存在，却常被拦下。现在插件默认额外放行这些常见用户目录，同时保留 `channels.wecom.media.localRoots` 继续追加共享盘、挂载盘和业务目录。

#### 📌 v2.3.18（2026-03-18）
- **[重大升级] 双平面能力融合（Bot WS ＋ MCP 强化）** 🚀 独家引入挂载式的 MCP 能力层。在保留原生 Agent 强力工具的同时，将官方新开放的企业微信能力暴露给大模型。现在，大模型可凭用户身份读写待办、日程、查通讯录。
- **[多账号硬隔离]** 彻底重构 MCP 缓存池实现 `accountId + category` 的二次硬维隔离，无论您的矩阵挂载了多少家企业的助手，上下文及鉴权缓存绝不会交叉重叠。
- **[媒体通道重构]** 补齐 Bot WS 本地的媒体上传链，同时设立了严格的 `5秒熔断机制`，若 WebSocket 长通道大文件卡死将无感静默降级到 Agent 私信发送。

*(查看更早期关于“超时熔断代投、动态扩容矩阵”等功能的更新日志，请移步 [changelog/ 目录](./changelog/))*

---

## 一、🚀 快速开始

> 推荐统一使用**多账号矩阵模型**。 
> 即使您的企业只接入了一个账号，也强烈建议将其配入 `channels.wecom.accounts.default` 节点下。

### 1.1 插件安装

```bash
openclaw plugins install @yanhaidao/wecom
openclaw plugins enable wecom
```

### 1.2 互动向导式初配 (适合个人开发者与极客)

如果您不想手写繁杂的 JSON 配置文件，可以通过交互式向导快速完成最轻量的 WebSocket 长连接部署。`v2.3.27` 起，`wecom` 已重新对齐 OpenClaw 当前的 guided setup 流程，`openclaw channels add` 可以直接识别并进入配置：

1. 确保已启用本插件。
2. 在终端运行添加渠道指令：
   ```bash
   openclaw channels add
   ```
3. 选择下拉列表中第一顺位的：**企业微信 (WeCom)**
4. 根据终端亮色指引，填入企微机器人对应的 `Bot ID` 及 `Secret`，机器人即可完成握手并进入可用状态。

> **如果您最近刚升级 OpenClaw：**
> - 若之前在添加渠道时看到 `wecom does not support guided setup yet`，请更新到当前版本后重试。
> - 若之前在渠道添加阶段见过 `ReferenceError: installedCatalogById is not defined`，这一版也已一并修复。

### 1.3 生产环境顶配架构示范（Bot WS 流式交互 + Agent 私有通道兜底发送）

如果您的目标不是“接进来能聊两句”，而是让团队在企业微信里长期稳定使用 AI，这套组合更接近生产环境的推荐形态：

- `Bot WS` 负责实时对话、低延迟流式回复和更轻的接入门槛
- `Agent` 负责主动推送、媒体发送和长任务后的兜底交付
- `dynamicAgents` 负责把不同用户、不同群聊的会话真正隔离开，避免多人共用一个入口时互相串上下文

请进入 OpenClaw 配置文件（`openclaw.json`）的 `channels.wecom` 内使用：

```jsonc
{
  "channels": {
    "wecom": {
      "enabled": true,
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "enabled": true,
          "name": "企微销售二部支持中枢",
          "bot": {
            "primaryTransport": "ws",             // 指定 Bot 主通讯协议：ws 或 webhook
            "streamPlaceholderContent": "正在深思熟虑，请稍候...", // 避免流式回复开始前长时间无反馈
            "welcomeText": "你好，我是已连网的专属大脑。",
            "dm": {
              "policy": "pairing",
              "allowFrom": []
            },
            "ws": {                               // Bot WS 建连所需凭证
              "botId": "YOUR_BOT_ID",
              "secret": "YOUR_BOT_SECRET"
            }
          },
          "agent": {                              // 主动推送、媒体发送与兜底交付链路
            "corpId": "YOUR_CORP_ID",
            "agentSecret": "YOUR_AGENT_SECRET",
            "agentId": 1000001,
            "token": "AGENT_TOKEN",
            "encodingAESKey": "AGENT_AES_KEY",
            "welcomeText": "若长连接断开，我将使用此通道传递残存报告。",
            "dm": {
              "policy": "open",
              "allowFrom": []
            },
            "upstreamCorps": {                    // 可选：给上下游企业用户发消息时使用
              "ww_partner_corp": {
                "corpId": "ww_partner_corp",
                "agentId": 1000002
              }
            }
          }
        }
      },
      "mediaMaxMb": 50,                           // 优先使用 OpenClaw 标准媒体上限配置
      "media": {
        "tempDir": "/tmp/openclaw-wecom-media",
        "localRoots": [
          "/srv/company-share",
          "/data/reports"
        ]
      },
      "network": {                                // 内网或受限网络环境可通过代理出网
        "egressProxyUrl": "http://127.0.0.1:3128"
      },
      "dynamicAgents": {                          // 为单聊/群聊创建独立路由，减少多人串上下文
        "enabled": true,
        "dmCreateAgent": true,
        "groupEnabled": true,
        "adminUsers": ["zhangsan001"]             // 管理员绕过动态路由，直连主 Agent
      }
    }
  }
}
```

其中：

- 插件现在默认额外放行常见用户目录：`~/Desktop`、`~/Documents`、`~/Downloads`、`~/Movies`、`~/Pictures`。
- `channels.wecom.mediaMaxMb` 是首选的媒体大小上限配置，`channels.wecom.accounts.<id>.mediaMaxMb` 可以做账号级覆盖。
- `channels.wecom.media.localRoots` 用于继续追加你自己的全局目录，例如共享盘、挂载盘或业务导出目录。
- 旧的 `channels.wecom.media.maxBytes` 仍然兼容，但仅作为向后兼容兜底；新配置建议统一改成 `mediaMaxMb`。
- 这些目录会和 OpenClaw 默认允许的媒体目录一起生效，不会覆盖默认白名单。
- 也就是说，像 `~/Downloads/01.png` 这类本机文件现在默认就可以直接发到企微，不需要再单独配置。
- 如果你需要给上下游企业用户回消息，可以在 `agent` 下追加 `upstreamCorps`；下面的 `1.6` 会单独展开说明。

> **注意：** 历史配置里的 `agent.corpSecret` 引擎依然能够向后兼容拾起，但后续的新项目推荐采用标准的 `agentSecret` 作为对齐键。

### 1.4 dynamicAgents 详细说明：为什么生产环境建议开启

`dynamicAgents` 的核心价值，不是“自动创建很多 Agent”，而是让企业微信里的每个用户、每个群聊都拥有稳定、独立的会话落点。  
如果不开它，所有消息更容易汇入同一个主 Agent；一旦开始多人共用，最先出问题的通常不是模型能力，而是上下文、长期记忆和处理边界混在一起。

更简单地看，可以直接按下面这张表决定要不要开：

| 场景 | 不开时的问题 | 建议配置 | 你得到的结果 |
|---|---|---|---|
| 多个同事同时私聊同一个机器人 | 容易共用同一条会话脉络，长期上下文可能互相污染 | `enabled=true` + `dmCreateAgent=true` | 每个人都有自己的稳定上下文 |
| 一个或多个群长期拿机器人协作 | 不同群更容易共用主 Agent，群与群之间边界不清晰 | `enabled=true` + `groupEnabled=true` | 每个群都有独立会话空间 |
| 管理员需要统一测试、巡检、接管 | 管理员也会被切进自己的动态 Agent，排障更分散 | `adminUsers=["管理员userid"]` | 管理账号继续直连主 Agent |
| 只是做 PoC 或单人试用 | 一上来就启用隔离，理解成本偏高 | `enabled=false` | 先把连通性和基础回复跑通 |

系统当前的真实行为如下：

- 开启后，会按 `账号 + 会话类型 + 对端 ID` 生成确定性的 Agent ID，例如 `wecom-default-dm-zhangsan` 或 `wecom-default-group-wr123456`
- 同一个用户或同一个群，下次再发消息时会继续命中同一个动态 Agent，而不是临时随机分配
- 首次命中时，插件会自动把这个动态 Agent 追加到 `agents.list`，不需要您手工维护一长串列表
- 这套逻辑同时作用于 `Bot WS` 和 `Agent Callback` 两条主消息链路，不是只有某一种模式才生效
- `adminUsers` 中的账号会始终绕过动态路由，直接走主 Agent，适合放管理员、运营或排障账号
- 默认值是 `enabled=false`、`dmCreateAgent=true`、`groupEnabled=true`、`adminUsers=[]`，也就是不开总开关时不会生效，但一旦开启，单聊和群聊会默认一起进入隔离模式

需要注意的是，`dynamicAgents` 解决的是“路由隔离”和“会话隔离”，不是权限系统本身。  
也就是说，它能显著减少上下文串线，但账号是否允许私聊、谁能触发命令、某个账号绑定到哪个主 Agent，仍然要结合 `dm.policy`、`bindings` 和企业微信授权配置一起看。

### 1.5 `localRoots` 详细说明：为什么“文件明明存在”，系统却仍然不发

`localRoots` 只决定一件事：**这个本地路径允不允许被当作可发送媒体读取。**

| 现象 | 实际含义 |
|---|---|
| 文件存在，但发送失败 | 不代表系统允许读取它 |
| 日志出现 `Local media path is not under an allowed directory` | 路径不在白名单里 |
| 远程 `https://...` 媒体可以发 | 远程 URL 不走 `localRoots` |

默认已经额外放行这些目录：

| 默认允许目录 | 用途 |
|---|---|
| `~/Desktop` | 桌面文件、临时截图 |
| `~/Documents` | 文档导出目录 |
| `~/Downloads` | 下载图片、下载文件 |
| `~/Movies` | 视频文件 |
| `~/Pictures` | 图片、相册导出 |

另外也保留 OpenClaw 自己的 `tmp / state / workspace` 相关目录。

如果文件不在默认目录里，再补 `localRoots`：

```json
{
  "channels": {
    "wecom": {
      "media": {
        "localRoots": [
          "/srv/company-share",
          "/data/reports",
          "/mnt/nas/public"
        ]
      }
    }
  }
}
```

配置规则：

| 规则 | 说明 |
|---|---|
| `localRoots` 是追加 | 不会覆盖默认目录 |
| 建议写绝对路径 | 团队环境更稳定、更清楚 |
| 只加业务需要的目录 | 不要为了省事把范围放太大 |
| 不建议放整个大盘或整个用户目录 | 会把本地文件读取边界放得过宽 |

排障判断：

| 问题类型 | 看什么 |
|---|---|
| 本地路径是否允许读取 | `localRoots` |
| 媒体能处理多大 | `channels.wecom.mediaMaxMb` |
| 企业微信最终能不能收 | 企业微信自身媒体限制 |
| 远程媒体能不能发 | URL 可访问性，不看 `localRoots` |

一句话：`localRoots` 管“能不能读这个本地路径”，`mediaMaxMb` 管“最多读多大”。 

### 1.6 上下游企业配置：如何给上下游企业用户发消息

如果你的企业微信应用已经共享给上下游企业，插件现在可以根据下游企业的 `CorpID` 和 `AgentID`，把回复准确发回对应的上下游用户。

这件事适合的场景很明确：

- 你的主企业已经把自建应用共享给经销商、供应商或合作方
- 这些上下游企业用户会从不同 `CorpID` 进入同一个 Agent 通道
- 你希望插件能自动识别“这是下游企业用户”，并走对应企业的应用身份发消息

最小配置示例如下：

```jsonc
{
  "channels": {
    "wecom": {
      "accounts": {
        "default": {
          "agent": {
            "corpId": "ww_primary_corp",
            "agentId": 1000001,
            "agentSecret": "PRIMARY_AGENT_SECRET",
            "token": "PRIMARY_CALLBACK_TOKEN",
            "encodingAESKey": "PRIMARY_ENCODING_AES_KEY",
            "upstreamCorps": {
              "ww_partner_corp": {
                "corpId": "ww_partner_corp",
                "agentId": 1000002
              }
            }
          }
        }
      }
    }
  }
}
```

可以这样理解这组配置：

- `agent.corpId` / `agent.agentId` 是上游主企业自己的应用配置
- `upstreamCorps.<key>.corpId` 是某个下游企业的 `CorpID`
- `upstreamCorps.<key>.agentId` 是这个下游企业里共享应用对应的 `AgentID`
- 下游企业不需要单独配置 `agentSecret`；仍然使用主企业应用的鉴权链路

这些参数通常可以从两条路拿到：

- 直接从企业微信管理后台查看下游企业的 `CorpID` 和共享应用的 `AgentID`
- 通过企业微信“获取应用共享信息”接口批量拉取

如果你打算走自动拉取，最关键的信息只有两个：

- 官方文档：`https://developer.work.weixin.qq.com/document/path/95813`
- 你需要把返回里的 `corp_list[].corpid` 映射到 `upstreamCorps.<key>.corpId`，把 `corp_list[].agentid` 映射到 `upstreamCorps.<key>.agentId`

插件内部的工作逻辑是：

- 收到消息时，会先看回调里的 `ToUserName`
- 如果这个 `CorpID` 和主企业 `corpId` 不一致，就把它识别成上下游企业用户
- 回复时会自动走对应的上下游 target 和下游企业配置，而不是误发回主企业通道

需要特别注意三点：

- `upstreamCorps` 只解决“发给哪个下游企业”的问题，不替代主企业应用本身的授权配置
- 上下游企业需要先在企业微信后台完成应用共享，并确保应用已加入“可调用接口的应用”
- 如果你只是想快速看完整字段说明、接口映射和日志样例，可以直接看 [UPSTREAM_CONFIG.md](./UPSTREAM_CONFIG.md)

---

## 二、🏢 企业微信后台回调挂载指南 (针对使用了 Webhook 或 Agent Callback 的重度用户)

如果您需要让 Agent 通道接收复杂的地理位置及交互式卡片事件，需要将系统的路径下发到企业微信管理后台。
由于系统默认采纳**多账号分流路径派生**，请切记不要随意丢弃末尾的 `{accountId}`，如下所示：

| 类型 | 您的 OpenClaw 可信域名 | 默认账号路由锚点 | 如果配置了 Ops 项目组子账号 |
|---|---|---|---|
| **Bot Webhook** | `https://x.com` | `/plugins/wecom/bot/default` | `/plugins/wecom/bot/ops` |
| **Agent Callback** | `https://x.com` | `/plugins/wecom/agent/default`| `/plugins/wecom/agent/ops` |

*警告：极度不推荐将老旧单一根路径（如 `/plugins/wecom/bot`）在未指定账户空间下裸奔使用，一旦您的业务扩张到第二个账号，将会引发难以追溯的回调抢占雪崩。*

---

## 三、📡 排障与抓包：洞悉黑盒下的脉搏

当前版本请使用以下三条命令组合排障。注意：`openclaw channels status` **不支持** `--deep`，插件级探测参数是 `--probe`；`--deep` 属于顶层 `openclaw status`。

### 3.1 先看插件级状态快照

```bash
openclaw channels status --probe
```

适合回答这些问题：

- 企业微信账号是否已被网关识别并加载
- 账号当前是否 `enabled` / `configured`
- 运行时是否 `running` / `connected` / `authenticated`
- 最近一次错误、最近进出站时间是否异常

如果网关可达，这条命令会返回企业微信账号的运行时快照。  
如果网关不可达，它会自动退化为“只看配置”的摘要输出。

### 3.2 再看全局深度诊断

```bash
openclaw status --deep
```

这条命令是 **OpenClaw 全局诊断入口**，适合确认：

- Gateway 本身是否健康
- 当前机器上的整体通道探测是否正常
- 最近心跳、会话、服务状态是否异常

当您怀疑问题不只在企业微信插件，而是 Gateway、网络、配置路径或其他通道共同影响时，优先跑这条。

### 3.3 最后直接看 WeCom 日志

```bash
openclaw channels logs --channel wecom --lines 200
```

当发生疑难连接断开、消息不回、媒体文件下发神秘消失时，直接看日志最有效。新版日志已经被精细地切分在不同命名空间锚点下，助你顺藤摸瓜：

- `[wecom-runtime]`：统一运行时主线。看收消息、分发、回消息、最近错误与会话归属漂移。
- `[wecom-ws]`：Bot WebSocket 通道。看连接、鉴权、断线、重连、帧收发与保活。
- `[wecom-agent-delivery]`：Agent 主动发送链路。看用户/部门/标签目标解析、媒体发送和账号错配。

### 3.4 推荐排障顺序

建议按下面顺序执行：

```bash
openclaw channels status --probe
openclaw status --deep
openclaw channels logs --channel wecom --lines 200
```

您可以按输出这样判断：

- `configured=false`：先检查 `bot.ws.botId`、`bot.ws.secret`、`agent.corpId`、`agent.agentSecret`、`agent.agentId` 等配置是否完整。
- `running=false`：说明账号没有真正启动，优先看 `[wecom-runtime]`。
- `connected=false` 或 `authenticated=false`：优先看 `[wecom-ws]`，一般是 WebSocket 握手、密钥或连接稳定性问题。
- 能收不能发，或群里发文件/卡片失败：优先看 `[wecom-agent-delivery]`。
- `lastError` 持续刷新：通常不是一次性误报，建议结合最近 200 行日志一起看。

---

## 四、🤝 项目协作者

感谢所有为本项目提交代码、测试、文档与反馈的协作者。

<p align="center">
  <a href="https://github.com/YanHaidao/wecom/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=YanHaidao/wecom" alt="WeCom contributors" />
  </a>
</p>

如果头像墙没有立刻刷新，通常是 GitHub 统计或第三方缓存延迟，稍后再看即可。

---

## 五、📮 联系作者 与 许可证协议指引

<p>
  如果您在搭建这套极度庞大的多端复合体系时遇到迷思，或者对底层代理流量重定向有着深度企业定制化需求，请毫无顾虑地与我连接：
</p>

- 微信直接交流群（扫描底部二维码进群探讨技术）：
- **维护者**：YanHaidao 

![企业微信交流群](https://openclaw.cc/wechat-github.jpg)

### 最后的话：关于开源及署名
本项目遵循 **ISC License**，您可以将其用于极其广阔的项目天地中。但开源不是拿来主义：
在此明确强调，包括所谓的“Bot+Agent 保活接力超时融合机制”、“千人千面多账户切面”、“自动寻的路由下沉” 这背后全是作者无数个在企业真实现网撞墙实验出的架构结晶。**拒绝一切去除原作者署名、粗暴改名换姓占为己用的魔改上架行为。**
愿我们能在彼此尊重的前提下，共同拓展 OpenClaw 生态的无垠边界。
