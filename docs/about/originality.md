---
layout: default
title: 原创声明
parent: 关于项目
nav_order: 1
---

# 原创声明

## 作者与项目归属

- **作者 & 主要维护者：** YanHaidao（GitHub: [YanHaidao](https://github.com/YanHaidao)）
- **联系方式：** VX: YanHaidao / Email: yanhaidao@qq.com
- **上游仓库：** [https://github.com/YanHaidao/wecom](https://github.com/YanHaidao/wecom)
- **License：** ISC

本项目是 OpenClaw WeCom 插件的**上游源码仓库（Source of Truth）**，所有官方版本均由此仓库发布。

## 核心设计原创声明

本项目涉及的以下核心设计，均为作者 **YanHaidao** 独立思考与实践的原创成果：

1. **多账号隔离与矩阵路由架构**  
   按 `(底层账号 + 部门/群组/人员)` 动态切分运行上下文和 Agent 实例，实现多人共用同一入口时的硬隔离。

2. **Bot + Agent 双模融合架构**  
   同时兼容 Bot WebSocket 实时会话与自建应用 Agent 回调，统一运行时与路由策略，避免同一用户在不同入口下行为割裂。

3. **长任务超时接力逻辑**  
   先保活、再流式推进；必要时切换投递路径，把最终结果交付出去，避免长推理因响应窗口过短而丢失。

4. **全自动媒体流转接**  
   补齐 Bot WS 本地媒体上传链，设立熔断机制，长通道大文件卡死时静默降级到 Agent 私信发送。

## 引用与协作规范

- 欢迎技术交流与合规引用。
- 严禁任何不经授权的“功能像素级抄袭”或删除原作者署名的代码搬运行为。
- 如需在企业内部或商业场景中深度集成，建议保留上游来源声明与作者署名。

## 共同维护

本项目采用**共同维护模式**，Tencent Cloud 贡献者欢迎作为联合维护者参与代码、文档、测试与云部署适配。具体协作规则请参见 [GOVERNANCE.md](https://github.com/YanHaidao/wecom/blob/main/GOVERNANCE.md)。
