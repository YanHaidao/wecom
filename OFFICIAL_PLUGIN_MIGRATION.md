# 官方主线同步与本地融合规则

## 项目定位

`YanHaidao/wecom` 是唯一开发、发布和部署仓库，交付包为 `@yanhaidao/wecom`，插件 ID 与
Channel ID 均为 `wecom`。

`WecomTeam/wecom-openclaw-plugin` 是只读功能主线。官方已经实现的 Channel、协议和标准业务能力，
以官方实现为迁移基准；YanHaidao 已有的多企业隔离、增强工具、诊断和安全能力保留在同一个插件中。
本项目不向官方仓库提交代码，也不在运行时同时安装两个 WeCom Channel 所有者。

## 仓库边界

| 仓库 | 用途 | 写入规则 |
| --- | --- | --- |
| `YanHaidao/wecom` | 唯一产品仓库和发布源 | 所有融合修改、测试与文档都在这里完成 |
| `WecomTeam/wecom-openclaw-plugin` | 官方功能与协议基线 | 只允许 fetch 和读取，禁止 push |
| `openclaw/openclaw` | Plugin SDK 与宿主兼容基线 | 独立更新，不承载本插件代码 |

本仓库的 `origin` 指向 `YanHaidao/wecom`；`official` 指向腾讯官方仓库，且 push URL 被设置为
`DISABLED`。两个项目没有共同 Git 历史，因此不使用普通 `git merge official/main`。同步采用“比较官方
基线、审阅变更、迁移到本仓库、重新验证本地差异”的方式。

当前基线记录在 `UPSTREAM_BASELINE.json`：

- 官方 commit：`3b1cbe3e664352821758d99ae5907f5620fce26e`
- 官方包版本：`2026.8.17`
- OpenClaw：`2026.8.1`
- Node.js 验证版本：`24.15.0`

## 单插件能力归属

| 能力表面 | 本仓库中的来源与规则 |
| --- | --- |
| `wecom` Channel、onboarding、账号解析 | 跟踪官方实现 |
| Bot WebSocket、Bot Webhook、Agent XML Webhook | 跟踪官方协议与路由实现 |
| 普通消息、媒体、模板卡片、主动发送与回退 | 跟踪官方实现，本地兼容修复必须有回归测试 |
| `wecom-cli` 与 16 个 Skills | 跟踪官方业务能力和 Skill 文档 |
| `upstreamCorps` 多企业身份与 token 交换 | YanHaidao 保留能力，融合进 Agent 入站和出站主链路 |
| `wecom_doc` | 官方 CLI 尚未覆盖的文档权限、分享、收集表和高级智能表格动作 |
| `wecom_calendar` | 官方 CLI 尚未覆盖的日历容器与系统日历动作 |
| 多账号绑定、防串号与失败关闭 | YanHaidao 保留能力 |
| `openclaw wecom diagnose` 与安全审计 | YanHaidao 保留能力 |
| 严格 HTTP 代理、超时与依赖边界 | YanHaidao 保留能力 |

官方标准动作不会在增强工具中重复注册。旧 `wecom_mcp` 已由 `wecom-cli` 取代；增强工具继续使用
`wecom_doc` 和 `wecom_calendar`，并绑定当前 WeCom 会话的 `accountId`。

### `wecom_doc` 保留动作

- 文档复制、分享、删除、权限读取与诊断、分享链接校验。
- 文档安全设置、成员通知范围和高级账号管理。
- 收集表创建、修改、答案与统计。
- 智能表格分组、外部记录和高级权限规则。
- 普通文档图片上传。

创建、重命名、内容读写、成员管理、在线表格和常规智能表格操作由 `wecom-cli` 提供，不在
`wecom_doc` 中重复暴露。

### `wecom_calendar` 保留动作

- 日历容器创建、更新、读取和删除。
- 系统日历 ID 查询和系统日历日程创建。

常规日程增删改查、参与人和闲忙查询由 `wecom-cli` 提供。

## `upstreamCorps` 融合原则

`upstreamCorps` 已直接进入本仓库的完整 Channel 主链路，不再等待官方仓库接收补丁：

1. Agent 回调通过 `ToUserName` 区分主企业和下游企业。
2. 回复目标编码为带 `accountId`、下游 `corpId` 和用户 ID 的规范目标。
3. 主企业 token 通过 `corpgroup/corp/gettoken` 换取下游 token。
4. 文本、媒体上传和发送复用同一套 Agent API 路径。
5. 映射缺失、重复、无效或跨账号时失败关闭，不回退到主企业或 Bot。
6. 上下游群回调在没有可靠身份模型前保持拒绝。

配置与安全约束见 `docs/UPSTREAM_CONFIG.md`。

## 官方同步流程

```bash
npm run upstream:check
```

该命令只 fetch `official/main`，然后输出记录基线与当前官方主线之间的 commit 数和受跟踪文件差异。
发现新版本后按以下顺序处理：

1. 审阅 `UPSTREAM_BASELINE.json` 记录的 commit 到 `official/main` 的变化。
2. 优先迁移官方 Channel、协议、配置、Skills 和标准 CLI 变化。
3. 对与本地能力重叠的文件做语义合并，保持 `upstreamCorps`、增强工具、账号绑定和诊断不回退。
4. 修正新 OpenClaw Plugin SDK 的公开接口，不保留已删除接口的兼容调用。
5. 运行单元测试、构建、打包内容检查和隔离安装。
6. 只有审阅与验证全部通过后才更新 `UPSTREAM_BASELINE.json`；更新基线不等于发布或版本升级。

脚本的最后提示固定要求“迁移到本仓库，永远不要 push 到 official remote”。

## 安装与冲突规则

只安装本仓库的包：

```bash
openclaw plugins install --accept-capabilities @yanhaidao/wecom
```

不得同时启用 `wecom-openclaw-plugin`。诊断命令会把第二个 Channel 所有者、旧工具授权、多账号
binding 缺失和 `upstreamCorps` 漂移报告为错误：

```bash
openclaw plugins doctor
openclaw wecom diagnose --json
openclaw security audit --deep
openclaw channels status --probe
```

## 发布与回滚

提交、推送、版本号变更和 npm 发布都需要仓库所有者明确授权。生产切换前先备份 OpenClaw 配置和
现用插件包，在隔离状态目录完成 `@yanhaidao/wecom` 单包安装验证。回滚时恢复上一版
`@yanhaidao/wecom` 和对应配置；不要通过重新启用腾讯官方插件来做不完整回滚。

真实企业微信回调、消息、媒体、配对、多账号和上下游企业回环必须按
`OFFICIAL_CAPABILITY_ACCEPTANCE.md` 留存脱敏证据。
