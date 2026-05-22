---
layout: default
title: 开发指南
parent: 关于项目
nav_order: 3
---

# 开发指南

本页面向希望为 WeCom 插件贡献代码、在本地调试或进行二次开发的开发者。

## 环境要求

| 项目 | 要求 |
|:---|:---|
| Node.js | 18 或更高版本 |
| OpenClaw | `2026.3.23-2` 或更高版本 |
| Git | 任意较新版本 |
| 包管理器 | npm / yarn / pnpm 均可 |

## 仓库结构

```
wecom/
├── index.ts              # 插件入口，注册渠道、路由、工具与事件监听
├── src/
│   ├── channels/         # 渠道注册与消息收发核心
│   ├── dispatchers/      # 消息派发与路由逻辑
│   ├── deliverers/       # 消息投递（Bot WS / Agent）
│   ├── models/           # 数据模型与类型定义
│   ├── utils/            # 工具函数
│   └── scripts/          # 本地脚本运行时支持
├── docs/                 # 帮助文档站点（Jekyll + Just the Docs）
├── changelog/            # 各版本详细变更简报
├── index.test.ts         # 入口测试
├── package.json          # 插件配置与依赖
├── tsconfig.json         # TypeScript 编译配置
└── vitest.config.ts      # 测试配置
```

## 本地开发流程

### 1. 克隆仓库

```bash
git clone https://github.com/YanHaidao/wecom.git
cd wecom
```

### 2. 安装依赖

```bash
npm install
```

### 3. 运行测试

本项目使用 [Vitest](https://vitest.dev/) 作为测试框架。

```bash
# 运行所有测试
npx vitest run

# 开发模式（监听变更）
npx vitest
```

测试配置位于 `vitest.config.ts`。若项目位于 OpenClaw 扩展目录中，会自动复用上级目录的共享配置；独立运行时则使用本地默认配置。

### 4. 类型检查

```bash
npx tsc --noEmit
```

`tsconfig.json` 已启用 `strict: true`，请确保代码通过严格类型检查。

### 5. 在 OpenClaw 中加载本地插件

```bash
# 假设 OpenClaw 已安装，且当前目录为 wecom 插件根目录
openclaw plugins link .
openclaw plugins enable wecom
```

修改代码后，重启 OpenClaw 即可加载最新版本。

## 提交代码

1. 从 `main` 分支创建特性分支：
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. 提交变更，保持提交信息清晰：
   ```bash
   git commit -m "feat: 新增菜单事件路由支持"
   ```

3. 推送到你的 Fork 并提交 Pull Request：
   ```bash
   git push origin feature/your-feature-name
   ```

4. 在 PR 描述中说明：
   - 变更目的
   - 主要修改点
   - 测试方式与验证结果

## 开发注意事项

- **保持向后兼容**：配置结构变更时，尽量提供默认值或迁移提示。
- **日志规范**：新增功能时请使用恰当的日志级别（`debug` / `info` / `warn` / `error`），便于用户排障。
- **类型安全**：所有公共 API 和数据结构应附带 TypeScript 类型定义。
- **文档同步**：用户可见的变更必须同步更新 `docs/` 下的对应页面。

## 相关资源

- [GOVERNANCE.md](https://github.com/YanHaidao/wecom/blob/main/GOVERNANCE.md) — 项目治理与决策流程
- [问题反馈](https://github.com/YanHaidao/wecom/issues) — 提交 Bug 或功能请求
- [快速开始]({{ site.baseurl }}/quick-start/quick-start.html) — 快速验证插件运行
