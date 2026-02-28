# 模型与供应商管理 (Model & Provider Management)

本目录包含了 Open Zen 项目中“模型与供应商管理”功能模块的全栈技术文档。该模块是系统的核心基础设施，负责对接各 AI 服务商、管理模型元数据、实现模型自动发现以及维护用户的会话模型偏好。

## 模块总览

模型与供应商管理模块通过以下几个核心部分实现：

1.  **供应商管理 (Provider Management)**：
    *   管理 API 密钥、基础 URL 及供应商元数据。
    *   API Key 采用 AES 加密存储。
2.  **模型管理 (Model Management)**：
    *   维护模型名称、标识符（ID）、能力（如：对话、生图、视觉）及计费信息（Token 价格）。
    *   支持启用/禁用特定模型。
3.  **模型自动发现 (Model Auto-Discovery)**：
    *   通过适配器模式 (Adapter Pattern) 对接各供应商的 `/v1/models` 接口。
    *   自动抓取并解析模型列表，提取定价、上下文长度等增强信息（如 OpenRouter）。
4.  **会话模型策略 (Session Model Strategy)**：
    *   管理用户在前端的默认模型选择及持久化。
    *   提供模型降级机制，确保在默认模型失效时仍能维持基础服务。

## 文档列表

| 文档名称 | 核心内容 |
| :--- | :--- |
| [供应商管理.md](./供应商管理.md) | CRUD API、AES 加密实现、前端管理页面。 |
| [模型管理.md](./模型管理.md) | 模型元数据字段定义、计费逻辑、前端 Store 状态维护。 |
| [模型自动发现.md](./模型自动发现.md) | 适配器模式、正则单位解析、OpenRouter 增强字段支持。 |
| [会话模型策略.md](./会话模型策略.md) | localStorage 持久化、模型降级逻辑、默认模型继承机制。 |

## 技术栈

*   **后端**：Spring Boot, MyBatis-Plus, AES/ECB/PKCS5Padding 加密。
*   **前端**：React, Zustand, Tailwind CSS, Lucide Icons。
*   **数据库**：H2 文件库 (存储 `provider` 和 `ai_model` 表)。
