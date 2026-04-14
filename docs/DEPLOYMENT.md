---
layout: default
title: 文档更新说明
nav_order: 99
---

# 文档更新说明

## 已完成的更改

✅ 重构了文档目录结构，支持左侧导航下拉子标题
✅ 为每个主要章节创建了独立的子目录
✅ 更新了所有文档的front matter配置
✅ 配置了Just-The-Docs主题的导航层级

## 推送步骤

1. 在项目根目录执行：
```bash
git add .
git commit -m "重构文档结构，支持下拉子标题导航"
git push origin main
```

2. 等待GitHub Actions构建完成（约2-3分钟）

3. 检查构建状态：
   - 访问 https://github.com/luffy-2y3d/wecom/actions
   - 查看"Deploy GitHub Pages" workflow的运行状态

4. 如果构建失败，点击失败的workflow查看错误日志

## 预期效果

构建成功后，左侧导航栏将：
- 显示首页作为顶层
- 每个主要章节（如"快速开始"、"配置说明"等）可以作为可折叠的父菜单
- 点击父菜单可以展开显示子页面
- 支持最多3层导航深度
