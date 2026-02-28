# 工具调用系统 (Tool Calling System)

Open Zen 的工具调用系统允许 AI 模型与后端服务、外部 API 甚至本地文件系统进行交互。本系统基于 Spring Boot 与 OpenAI 的 Tool Calling 协议实现。

## 系统架构概览

工具调用系统由以下几个核心模块组成：

1.  **注解体系 (`@AiTool`)**: 提供元数据定义，自动生成 JSON Schema 供 AI 理解。
2.  **注册中心 (`ToolRegistry`)**: 统一管理所有可用工具。
3.  **执行链路 (`ChatService`)**: 处理“模型决策 -> 后端执行 -> 结果反馈”的递归循环。
4.  **安全授权 (Approval Flow)**: 针对敏感操作，支持用户手动授权/拒绝。
5.  **前端聚合 (Message Aggregation)**: 在聊天界面中将多次工具交互聚合成简洁的交互卡片。

## 目录指南

- [注解与注册](./注解与注册.md): 了解如何使用注解定义工具以及工具是如何被扫描进系统的。
- [工具调用链路](./工具调用链路.md): 深入理解 ChatService 内部的递归执行逻辑。
- [用户授权流](./用户授权流.md): 掌握授权中断与恢复的技术实现。
- [内置工具](./内置工具.md): 现有可用工具的功能说明及代码路径。
- [扩展新工具指南](./扩展新工具指南.md): **(必看)** 手把手教你如何增加一个新工具。

## 核心技术栈

- **Backend**: Java 21, Spring Boot 3.4.1
- **Frontend**: React 18, TypeScript, Zustand, Tailwind CSS
- **Protocol**: OpenAI Function Calling (JSON Schema)
