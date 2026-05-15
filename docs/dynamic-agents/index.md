---
layout: default
title: 动态 Agent
parent: 首页
nav_order: 5
has_children: true
---

# 动态 Agent

本部分介绍 `dynamicAgents` 的设计目标、配置方式、路由规则和排障方法。它和“上下游企业”是同级能力：前者解决企业微信内部的会话隔离，后者解决跨企业投递身份。

## 目录

- [dynamicAgents 详细说明](./dynamic-agents) - 多人、多群、多账号场景下的动态会话隔离

## 主要内容

- 为什么生产环境建议开启 `dynamicAgents`
- 动态 Agent ID 如何生成
- 私聊、群聊、管理员绕过的真实行为
- 和多账号、上下游企业、权限策略之间的边界
- 常见配置与排障方法
