# YanHaidao/wecom 全功能验收表

本表用于放行单一插件 `@yanhaidao/wecom`。源码存在、单元测试通过和插件加载成功只能证明离线合同，
不能替代真实企业微信回调、发送、权限和多企业回环证据。

## 验收基线

- 产品仓库：`YanHaidao/wecom`
- 官方参考仓库：`WecomTeam/wecom-openclaw-plugin`
- 官方参考 commit：`3b1cbe3e664352821758d99ae5907f5620fce26e`
- 官方参考版本：`2026.8.17`
- 本地包：`@yanhaidao/wecom@3.0.0`
- OpenClaw：`2026.8.1`
- Node.js：`24.15.0`

状态只使用 `PASS`、`FAIL`、`BLOCKED`、`NOT RUN`。真实测试的 `PASS` 必须记录日期、测试账号和脱敏
证据位置；不得提交 token、secret、手机号、真实文件内容或生产配置。

## 无凭据门槛

| ID | 验收项 | 当前状态 | 通过标准 |
| --- | --- | --- | --- |
| S01 | 仓库边界 | PASS | `origin` 指向 YanHaidao；`official` 只读且 push 为 `DISABLED` |
| S02 | 单一 Channel 所有者 | PASS | manifest 只声明插件和 Channel ID `wecom` |
| S03 | 完整入口 | PASS | 注册 1 个 Channel、5 条 HTTP route、3 个工具、1 个 CLI 和 1 个审计器；工具与媒体提示由 Channel 原生 agent prompt 提供 |
| S04 | 官方标准能力 | PASS | Bot WS/Webhook、Agent XML、媒体、卡片、CLI 和 16 个 Skills 已进入本仓库 |
| S05 | YanHaidao 差异能力 | PASS | `upstreamCorps`、增强工具、绑定与诊断均在单插件内 |
| S06 | 工具无重复 | PASS | `wecom-cli` 负责标准动作；`wecom_doc`、`wecom_calendar` 只负责缺口动作 |
| S07 | 配对命令授权 | PASS | 已批准的账号级 pairing store 同时放行私聊和控制命令；群聊不复用 DM 配对 |
| S08 | 单元测试 | PASS | Node 26.8.1：23 个测试文件、71 项测试全部通过；发布前使用 Node 24.15.0 复跑当前测试集 |
| S09 | TypeScript 构建 | PASS | Node 24.15.0：`npm run build` 无错误 |
| S10 | 上游检查 | PASS | `official/main` 与记录基线 `3b1cbe3` 一致 |
| S11 | npm 包内容 | PASS | tarball 含完整 dist、99 个 Skill/参考文件、许可与基线；无贡献补丁、锁文件或测试源码 |
| S12 | 隔离安装 | PASS | 清洁状态目录通过 `npm-pack:` 安装；依赖齐全，doctor 与 diagnose 均无诊断 |

## 真实 Channel 验收

| ID | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- |
| C01 | 未配对用户私聊，管理员 list/approve 后重试 | 审批前不进入 Agent；审批后同一账号能收发并执行控制命令 | NOT RUN |
| C02 | `dmPolicy=allowlist` 的允许和未允许用户 | 只处理允许用户，拒绝日志不泄露正文或凭据 | NOT RUN |
| C03 | 群白名单与群内成员白名单 | 只处理允许群和允许成员 | NOT RUN |
| C04 | Bot WebSocket 文本、引用和连续回复 | 会话、引用、回复目标正确且不重复 | NOT RUN |
| C05 | Bot WS 断线、重连和连续消息 | 自动恢复，无互踢、重复或最终回复丢失 | NOT RUN |
| C06 | Bot Webhook 验证和真实 JSON 回调 | 验证成功，消息只处理一次并回到原会话 | NOT RUN |
| C07 | Agent URL 验证和加密 XML 回调 | 解密、账号、会话和回复目标正确 | NOT RUN |
| C08 | Bot 不可用时 Agent 兜底 | 保持同一账号与目标，不跨企业、不误发 | NOT RUN |
| C09 | 两个账号并发消息与精确 bindings | 每条消息进入对应账号和 Agent，不回退默认账号 | NOT RUN |

## 媒体与卡片验收

| ID | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- |
| M01 | 收发图片、文件、语音和视频 | 类型、名称、大小、内容和会话正确 | NOT RUN |
| M02 | 超过直发上限但低于文件上限 | 按规则降级为文件，不静默丢失 | NOT RUN |
| M03 | 超过总文件上限或非法本地路径 | 明确拒绝且不读取未授权路径 | NOT RUN |
| M04 | 五类模板卡片及交互回调 | 结构、事件、去重、最终状态正确 | NOT RUN |
| M05 | Bot 到 Agent 的媒体兜底 | 下载、上传和发送成功，失败时有明确降级 | NOT RUN |

## 业务工具验收

| ID | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- |
| T01 | `wecom-cli` 消息、通讯录、文档和表格 | 使用当前账号凭据，结果与官方 CLI 语义一致 | NOT RUN |
| T02 | `wecom-cli` 日历、会议、邮件、微盘和待办 | 标准动作完整且错误可诊断 | NOT RUN |
| T03 | `wecom_doc` 权限、分享、收集表和高级规则 | 官方未覆盖动作可用，且不重复标准动作 | NOT RUN |
| T04 | `wecom_calendar` 日历容器与系统日历 | 当前账号内创建、读取、更新和删除正确 | NOT RUN |
| T05 | 多账号工具绑定 | 显式跨账号调用和缺失账号上下文均失败关闭 | NOT RUN |

## 上下游企业验收

| ID | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- |
| U01 | 主企业 Agent 回调 | 保持主企业 token、Agent ID 和会话目标 | NOT RUN |
| U02 | 已配置下游企业文本回调与回复 | 识别下游 corp，交换 token，并以对应 Agent ID 回复 | NOT RUN |
| U03 | 下游企业媒体收发 | 下载、上传和发送均使用下游身份 | NOT RUN |
| U04 | 未配置、重复或无效映射 | 回调失败关闭，不回退主企业 | NOT RUN |
| U05 | 跨账号复用下游目标 | 明确拒绝，不访问 API | NOT RUN |

## 运维验收

| ID | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- |
| O01 | 同时允许腾讯官方插件 | `wecom diagnose` 报告第二个 Channel 所有者 | NOT RUN |
| O02 | 多账号缺少 binding | 诊断列出缺失账号且不泄露凭据 | NOT RUN |
| O03 | `upstreamCorps` 重复或无效 | 诊断报告准确且失败关闭 | NOT RUN |
| O04 | 升级后回滚上一版包和配置 | Channel、工具和消息恢复，未启用第二个插件 | NOT RUN |

## 证据记录模板

```text
ID:
状态:
日期:
OpenClaw 版本/commit:
@yanhaidao/wecom 版本/commit:
测试账号（脱敏）:
操作:
预期:
实际:
证据位置（脱敏日志/截图/录屏）:
遗留问题:
```

生产切换需要 S01-S12 全部 `PASS`，并由操作者明确选择本次必须通过的真实测试范围。真实凭据缺失时，
相关项保持 `NOT RUN` 或 `BLOCKED`，不得用离线证据替代。
