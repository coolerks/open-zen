# 数据库设计文档

Open Zen 使用 H2 内嵌数据库存储配置与会话数据。

## 1. 数据库概况

- **数据库类型**: H2 (文件库)
- **文件路径**: `./data/aiagent`
- **连接 URL**: `jdbc:h2:file:./data/aiagent;AUTO_SERVER=TRUE`
- **初始化策略**: 
  - 启动时自动执行 `server/src/main/resources/schema.sql`。
  - 采用 `CREATE TABLE IF NOT EXISTS` 保证表结构幂等。
  - 采用 `ALTER TABLE ADD COLUMN IF NOT EXISTS` 实现增量字段迁移。
- **管理终端**: 支持 H2 Console，路径为 `/h2-console`。

---

## 2. 数据表设计

### 2.1 provider (供应商配置表)
存储不同 AI 服务商（如 OpenRouter, OpenAI 等）的连接凭证。

| 字段名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| id | BIGINT | 是 | | 主键 ID (自增) |
| name | VARCHAR(100) | 是 | | 供应商名称，例如 OpenRouter |
| base_url | VARCHAR(500) | 是 | | 供应商基础地址 |
| api_key | VARCHAR(1000) | 是 | | 加密后的 API Key |
| enabled | BOOLEAN | 是 | TRUE | 是否启用 |
| created_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 更新时间 |

**索引**:
- `idx_provider_enabled`: `enabled`

---

### 2.2 ai_model (模型配置表)
定义各供应商提供的模型及其能力（视觉、工具调用、推理等）与计费单价。

| 字段名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| id | BIGINT | 是 | | 主键 ID (自增) |
| provider_id | BIGINT | 是 | | 关联供应商 ID (外键) |
| model_key | VARCHAR(200) | 是 | | 模型唯一标识，例如 qwen/qwen3-coder:free |
| display_name | VARCHAR(200) | 是 | | 模型展示名称 |
| is_default | BOOLEAN | 是 | FALSE | 是否为默认模型 |
| supports_tools | BOOLEAN | 是 | FALSE | 是否支持工具调用 |
| supports_vision | BOOLEAN | 是 | FALSE | 是否支持视觉输入 |
| supports_reasoning | BOOLEAN | 是 | FALSE | 是否支持推理内容输出 |
| context_window_tokens | BIGINT | 否 | | 模型上下文窗口总 token 数 |
| max_completion_tokens | BIGINT | 否 | | 模型单次最大输出 token 数 |
| input_price | DECIMAL(20,10) | 否 | | 输入 token 单价（USD/Token） |
| output_price | DECIMAL(20,10) | 否 | | 输出 token 单价（USD/Token） |
| cache_read_price | DECIMAL(20,10) | 否 | | 缓存读取 token 单价（USD/Token） |
| cache_write_price | DECIMAL(20,10) | 否 | | 缓存写入 token 单价（USD/Token） |
| default_params | CLOB | 否 | | 模型默认参数 JSON |
| enabled | BOOLEAN | 是 | TRUE | 是否启用 |
| created_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 更新时间 |

**索引**:
- `idx_model_provider`: `provider_id`
- `idx_model_enabled`: `enabled`
- `idx_model_default`: `is_default`

---

### 2.3 custom_agent (智能体配置表)
定义智能体的角色、系统提示词以及外观。

| 字段名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| id | BIGINT | 是 | | 主键 ID (自增) |
| name | VARCHAR(100) | 是 | | 智能体名称 |
| description | VARCHAR(500) | 否 | | 智能体描述 |
| system_prompt | CLOB | 是 | | 系统提示词 |
| avatar_type | VARCHAR(20) | 否 | | 头像类型：emoji/image |
| avatar_value | CLOB | 否 | | 头像值：emoji 字符或图片 dataURL/地址 |
| is_default | BOOLEAN | 是 | FALSE | 是否为系统默认智能体 |
| enabled | BOOLEAN | 是 | TRUE | 是否启用 |
| created_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 更新时间 |

**索引**:
- `idx_agent_enabled`: `enabled`
- `idx_agent_default`: `is_default`

---

### 2.4 app_center_item (应用中心表)
存储用户从对话中提取的代码快照，方便作为独立应用运行或复用。

| 字段名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| id | BIGINT | 是 | | 主键 ID (自增) |
| name | VARCHAR(120) | 是 | | 应用名称 |
| icon_type | VARCHAR(20) | 否 | | 图标类型：emoji/image |
| icon_value | CLOB | 否 | | 图标内容：emoji 字符或图片 dataURL/地址 |
| source_key | VARCHAR(200) | 是 | | 来源代码块唯一标识 |
| source_session_id | BIGINT | 否 | | 来源会话 ID |
| source_session_title | VARCHAR(200) | 否 | | 来源会话标题快照 |
| source_message_id | BIGINT | 否 | | 来源消息 ID |
| source_model_id | BIGINT | 否 | | 来源模型 ID |
| source_model_name | VARCHAR(200) | 否 | | 来源模型名称快照 |
| language | VARCHAR(40) | 是 | | 代码语言 |
| code_content | CLOB | 是 | | 应用源码（通常为 HTML） |
| original_code_content | CLOB | 否 | | 应用初始源码快照（用于重置代码） |
| created_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 更新时间 |

**索引**:
- `uk_app_source_key` (唯一索引): `source_key`
- `idx_app_updated_at`: `updated_at`
- `idx_app_source_session`: `source_session_id`
- `idx_app_source_message`: `source_message_id`

---

### 2.5 chat_session (会话表)
存储用户聊天会话元数据，支持绑定智能体、模型以及所属项目。

| 字段名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| id | BIGINT | 是 | | 主键 ID (自增) |
| title | VARCHAR(200) | 是 | '新会话' | 会话标题 |
| model_id | BIGINT | 否 | | 会话最近一次使用模型 ID (外键) |
| agent_id | BIGINT | 否 | | 关联智能体 ID (外键) |
| project_id | VARCHAR(64) | 否 | | 所属项目 ID，空表示普通聊天会话 |
| enabled_tool_names | CLOB | 否 | | 会话允许调用的工具名称列表 JSON |
| parent_session_id | BIGINT | 否 | | 父会话 ID（复制或分支来源） |
| parent_message_id | BIGINT | 否 | | 分支起点消息 ID |
| is_temporary | BOOLEAN | 是 | FALSE | 是否临时会话：true 表示不进入会话列表 |
| created_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 更新时间 |

**索引**:
- `idx_session_updated_at`: `updated_at`
- `idx_session_project`: `project_id`
- `idx_session_parent`: `parent_session_id`
- `idx_session_temporary`: `is_temporary`

---

### 2.6 chat_message (消息表)
记录会话中的每一条消息，包含模型输出、推理过程、工具调用及费用统计。

| 字段名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| id | BIGINT | 是 | | 主键 ID (自增) |
| session_id | BIGINT | 是 | | 所属会话 ID (外键，级联删除) |
| role | VARCHAR(20) | 是 | | 消息角色：user/assistant/system/tool |
| content | CLOB | 否 | | 消息正文 |
| tool_calls | CLOB | 否 | | 工具调用 JSON |
| tool_call_id | VARCHAR(100) | 否 | | 工具调用 ID |
| token_usage | INT | 否 | | 本条消息 token 用量 |
| prompt_tokens | INT | 否 | | 本条消息输入 token 用量 |
| completion_tokens | INT | 否 | | 本条消息输出 token 用量 |
| cache_read_tokens | INT | 否 | | 本条消息缓存读取 token 用量 |
| cache_write_tokens | INT | 否 | | 本条消息缓存写入 token 用量 |
| cost_usd | DECIMAL(20,10) | 否 | | 本条消息估算成本（USD） |
| model_id | BIGINT | 否 | | 生成该消息使用的模型 ID |
| model_name | VARCHAR(200) | 否 | | 生成该消息使用的模型名称快照 |
| agent_id | BIGINT | 否 | | 生成该消息使用的智能体 ID |
| agent_name | VARCHAR(100) | 否 | | 生成该消息使用的智能体名称快照 |
| agent_avatar_type | VARCHAR(20) | 否 | | 智能体头像类型快照 |
| agent_avatar_value | CLOB | 否 | | 智能体头像内容快照 |
| reasoning_content | CLOB | 否 | | 模型推理内容 |
| reasoning_duration_ms | BIGINT | 否 | | 模型推理耗时（毫秒） |
| image_urls | CLOB | 否 | | 用户上传图片地址或 data URL 列表 JSON |
| created_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 创建时间 |

**索引**:
- `idx_message_session`: `session_id`
- `idx_message_session_created`: `session_id, created_at`
- `idx_message_agent_id`: `agent_id`

---

### 2.7 project_item (项目元数据表)
存储本地项目的关联路径，不存储文件内容本身。

| 字段名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| id | VARCHAR(64) | 是 | | 项目 ID（UUID） |
| name | VARCHAR(200) | 是 | | 项目名称 |
| description | CLOB | 否 | | 项目描述 |
| root_dir_name | VARCHAR(255) | 是 | | 项目根目录名称 |
| real_dir_path | VARCHAR(2000) | 是 | | 项目关联的真实目录绝对路径 |
| created_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 是 | CURRENT_TIMESTAMP | 更新时间 |

**索引**:
- `idx_project_updated_at`: `updated_at`

---

## 3. 关系说明

- **provider <-> ai_model**: 一对多。一个供应商下可以有多个模型配置。模型通过 `provider_id` 关联。
- **ai_model <-> chat_session**: 多对一。会话记录最后一次选用的模型 ID，但不限制会话内所有消息必须使用该模型。
- **custom_agent <-> chat_session**: 多对一。会话绑定一个默认智能体。
- **chat_session <-> chat_message**: 一对多。会话包含多条消息。删除会话时通过 `ON DELETE CASCADE` 级联删除所属消息。
- **chat_session <-> chat_session**: 自关联。通过 `parent_session_id` 记录会话的分支或复制来源。

---

## 4. 迁移与数据逻辑

### 4.1 增量迁移模式
由于 H2 数据库随应用启动初始化，为了保持现有数据不丢失且能同步结构变更，`schema.sql` 广泛使用如下模式：

```sql
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS column_name type;
```

这种方式确保了在多次启动过程中，若字段已存在则跳过，若不存在则新增，实现平滑升级。

### 4.2 数据回填逻辑
在 `app_center_item` 表引入 `original_code_content` 字段时，系统会自动执行初始化回填，将当前的 `code_content` 复制到快照字段中：

```sql
UPDATE app_center_item
SET original_code_content = code_content
WHERE original_code_content IS NULL;
```
此逻辑仅在快照为空时执行一次，用于保存 AI 生成的原始代码，方便用户后续进行代码重置。
