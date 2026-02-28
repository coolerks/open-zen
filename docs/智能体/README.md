# 智能体模块 (Agent Management)

智能体模块是 Open Zen 的核心功能之一，负责定义 AI 的角色行为、系统提示词以及视觉特征。

## 模块概述

本模块支持“默认智能体”与“自定义智能体”的共存与管理。通过智能体，用户可以为不同的对话场景预设不同的 AI 身份。

### 核心功能

- **智能体管理**：支持自定义智能体的增删改查。
- **默认智能体约束**：系统内置一个不可删除、不可禁用的默认智能体，确保系统始终可用。
- **头像系统**：支持 Emoji 头像和自定义图片头像。
- **消息快照**：在消息生成时持久化智能体元数据，确保历史对话展示的稳定性。

## 文件导读

### 后端 (Java)

- `CustomAgentController.java`: 提供智能体管理的 RESTful API。
- `CustomAgentService.java`: 核心业务逻辑，包含默认智能体归一化、保留名称校验、头像处理等。
- `CustomAgent.java`: 数据库实体类，对应 `custom_agent` 表。
- `AgentRequest.java` / `AgentResponse.java`: 数据传输对象 (DTO)。

### 前端 (TypeScript/React)

- `AgentsPage.tsx`: 智能体管理界面，包含列表展示、新建/编辑对话框及头像上传逻辑。
- `agentStore.ts`: 基于 Zustand 的状态管理，维护智能体列表及其变更状态。
- `agent.ts`: 封装与后端交互的 API 调用。

### 数据库

- `schema.sql`: 包含 `custom_agent` 表定义及 `chat_message` 中的智能体快照字段。

## 详细文档

- [智能体管理实现细节](./智能体管理.md)
