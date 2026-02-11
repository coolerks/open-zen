-- 供应商配置表：保存不同 AI 服务商的连接配置
CREATE TABLE IF NOT EXISTS provider (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    base_url    VARCHAR(500)  NOT NULL,
    api_key     VARCHAR(1000) NOT NULL,
    enabled     BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE provider IS 'AI 供应商配置表';
COMMENT ON COLUMN provider.id IS '主键 ID';
COMMENT ON COLUMN provider.name IS '供应商名称，例如 OpenRouter';
COMMENT ON COLUMN provider.base_url IS '供应商基础地址';
COMMENT ON COLUMN provider.api_key IS '加密后的 API Key';
COMMENT ON COLUMN provider.enabled IS '是否启用';
COMMENT ON COLUMN provider.created_at IS '创建时间';
COMMENT ON COLUMN provider.updated_at IS '更新时间';
CREATE INDEX IF NOT EXISTS idx_provider_enabled ON provider(enabled);

-- 模型配置表：模型绑定到具体供应商，能力按布尔开关标记
CREATE TABLE IF NOT EXISTS ai_model (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    provider_id         BIGINT        NOT NULL,
    model_key           VARCHAR(200)  NOT NULL,
    display_name        VARCHAR(200)  NOT NULL,
    is_default          BOOLEAN       NOT NULL DEFAULT FALSE,
    supports_tools      BOOLEAN       NOT NULL DEFAULT FALSE,
    supports_vision     BOOLEAN       NOT NULL DEFAULT FALSE,
    supports_reasoning  BOOLEAN       NOT NULL DEFAULT FALSE,
    context_window_tokens BIGINT,
    max_completion_tokens BIGINT,
    input_price         DECIMAL(20,10),
    output_price        DECIMAL(20,10),
    cache_read_price    DECIMAL(20,10),
    cache_write_price   DECIMAL(20,10),
    default_params      CLOB,
    enabled             BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_model_provider FOREIGN KEY (provider_id) REFERENCES provider(id)
);
ALTER TABLE ai_model ADD COLUMN IF NOT EXISTS supports_reasoning BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_model ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_model ADD COLUMN IF NOT EXISTS context_window_tokens BIGINT;
ALTER TABLE ai_model ADD COLUMN IF NOT EXISTS max_completion_tokens BIGINT;
ALTER TABLE ai_model ADD COLUMN IF NOT EXISTS input_price DECIMAL(20,10);
ALTER TABLE ai_model ADD COLUMN IF NOT EXISTS output_price DECIMAL(20,10);
ALTER TABLE ai_model ADD COLUMN IF NOT EXISTS cache_read_price DECIMAL(20,10);
ALTER TABLE ai_model ADD COLUMN IF NOT EXISTS cache_write_price DECIMAL(20,10);
COMMENT ON TABLE ai_model IS 'AI 模型配置表';
COMMENT ON COLUMN ai_model.id IS '主键 ID';
COMMENT ON COLUMN ai_model.provider_id IS '关联供应商 ID';
COMMENT ON COLUMN ai_model.model_key IS '模型唯一标识，例如 qwen/qwen3-coder:free';
COMMENT ON COLUMN ai_model.display_name IS '模型展示名称';
COMMENT ON COLUMN ai_model.is_default IS '是否为默认模型';
COMMENT ON COLUMN ai_model.supports_tools IS '是否支持工具调用';
COMMENT ON COLUMN ai_model.supports_vision IS '是否支持视觉输入';
COMMENT ON COLUMN ai_model.supports_reasoning IS '是否支持推理内容输出';
COMMENT ON COLUMN ai_model.context_window_tokens IS '模型上下文窗口总 token 数';
COMMENT ON COLUMN ai_model.max_completion_tokens IS '模型单次最大输出 token 数';
COMMENT ON COLUMN ai_model.input_price IS '输入 token 单价（USD/Token）';
COMMENT ON COLUMN ai_model.output_price IS '输出 token 单价（USD/Token）';
COMMENT ON COLUMN ai_model.cache_read_price IS '缓存读取 token 单价（USD/Token）';
COMMENT ON COLUMN ai_model.cache_write_price IS '缓存写入 token 单价（USD/Token）';
COMMENT ON COLUMN ai_model.default_params IS '模型默认参数 JSON';
COMMENT ON COLUMN ai_model.enabled IS '是否启用';
COMMENT ON COLUMN ai_model.created_at IS '创建时间';
COMMENT ON COLUMN ai_model.updated_at IS '更新时间';
CREATE INDEX IF NOT EXISTS idx_model_provider ON ai_model(provider_id);
CREATE INDEX IF NOT EXISTS idx_model_enabled ON ai_model(enabled);
CREATE INDEX IF NOT EXISTS idx_model_default ON ai_model(is_default);

-- 智能体配置表：用户可定义角色行为和特征
CREATE TABLE IF NOT EXISTS custom_agent (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    description   VARCHAR(500),
    system_prompt CLOB         NOT NULL,
    avatar_type   VARCHAR(20),
    avatar_value  CLOB,
    is_default    BOOLEAN      NOT NULL DEFAULT FALSE,
    enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE custom_agent ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE custom_agent ADD COLUMN IF NOT EXISTS avatar_type VARCHAR(20);
ALTER TABLE custom_agent ADD COLUMN IF NOT EXISTS avatar_value CLOB;
COMMENT ON TABLE custom_agent IS '自定义智能体配置表';
COMMENT ON COLUMN custom_agent.id IS '主键 ID';
COMMENT ON COLUMN custom_agent.name IS '智能体名称';
COMMENT ON COLUMN custom_agent.description IS '智能体描述';
COMMENT ON COLUMN custom_agent.system_prompt IS '系统提示词';
COMMENT ON COLUMN custom_agent.avatar_type IS '头像类型：emoji/image';
COMMENT ON COLUMN custom_agent.avatar_value IS '头像值：emoji 字符或图片 dataURL/地址';
COMMENT ON COLUMN custom_agent.is_default IS '是否为系统默认智能体';
COMMENT ON COLUMN custom_agent.enabled IS '是否启用';
COMMENT ON COLUMN custom_agent.created_at IS '创建时间';
COMMENT ON COLUMN custom_agent.updated_at IS '更新时间';
CREATE INDEX IF NOT EXISTS idx_agent_enabled ON custom_agent(enabled);
CREATE INDEX IF NOT EXISTS idx_agent_default ON custom_agent(is_default);

-- 应用中心表：保存用户从聊天代码块收藏的可复用应用
CREATE TABLE IF NOT EXISTS app_center_item (
    id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
    name                 VARCHAR(120) NOT NULL,
    icon_type            VARCHAR(20),
    icon_value           CLOB,
    source_key           VARCHAR(200) NOT NULL,
    source_session_id    BIGINT,
    source_session_title VARCHAR(200),
    source_message_id    BIGINT,
    source_model_id      BIGINT,
    source_model_name    VARCHAR(200),
    language             VARCHAR(40)  NOT NULL,
    code_content         CLOB         NOT NULL,
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE app_center_item ADD COLUMN IF NOT EXISTS icon_type VARCHAR(20);
ALTER TABLE app_center_item ADD COLUMN IF NOT EXISTS icon_value CLOB;
ALTER TABLE app_center_item ADD COLUMN IF NOT EXISTS source_key VARCHAR(200);
ALTER TABLE app_center_item ADD COLUMN IF NOT EXISTS source_session_id BIGINT;
ALTER TABLE app_center_item ADD COLUMN IF NOT EXISTS source_session_title VARCHAR(200);
ALTER TABLE app_center_item ADD COLUMN IF NOT EXISTS source_message_id BIGINT;
ALTER TABLE app_center_item ADD COLUMN IF NOT EXISTS source_model_id BIGINT;
ALTER TABLE app_center_item ADD COLUMN IF NOT EXISTS source_model_name VARCHAR(200);
ALTER TABLE app_center_item ADD COLUMN IF NOT EXISTS language VARCHAR(40);
ALTER TABLE app_center_item ADD COLUMN IF NOT EXISTS code_content CLOB;
COMMENT ON TABLE app_center_item IS '应用中心条目表';
COMMENT ON COLUMN app_center_item.id IS '主键 ID';
COMMENT ON COLUMN app_center_item.name IS '应用名称';
COMMENT ON COLUMN app_center_item.icon_type IS '图标类型：emoji/image';
COMMENT ON COLUMN app_center_item.icon_value IS '图标内容：emoji 字符或图片 dataURL/地址';
COMMENT ON COLUMN app_center_item.source_key IS '来源代码块唯一标识';
COMMENT ON COLUMN app_center_item.source_session_id IS '来源会话 ID';
COMMENT ON COLUMN app_center_item.source_session_title IS '来源会话标题快照';
COMMENT ON COLUMN app_center_item.source_message_id IS '来源消息 ID';
COMMENT ON COLUMN app_center_item.source_model_id IS '来源模型 ID';
COMMENT ON COLUMN app_center_item.source_model_name IS '来源模型名称快照';
COMMENT ON COLUMN app_center_item.language IS '代码语言';
COMMENT ON COLUMN app_center_item.code_content IS '应用源码（通常为 HTML）';
COMMENT ON COLUMN app_center_item.created_at IS '创建时间';
COMMENT ON COLUMN app_center_item.updated_at IS '更新时间';
CREATE UNIQUE INDEX IF NOT EXISTS uk_app_source_key ON app_center_item(source_key);
CREATE INDEX IF NOT EXISTS idx_app_updated_at ON app_center_item(updated_at);
CREATE INDEX IF NOT EXISTS idx_app_source_session ON app_center_item(source_session_id);
CREATE INDEX IF NOT EXISTS idx_app_source_message ON app_center_item(source_message_id);

-- 会话表：支持复制、分支、绑定智能体与默认模型
CREATE TABLE IF NOT EXISTS chat_session (
    id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
    title              VARCHAR(200)  NOT NULL DEFAULT '新会话',
    model_id           BIGINT,
    agent_id           BIGINT,
    parent_session_id  BIGINT,
    parent_message_id  BIGINT,
    created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_session_model FOREIGN KEY (model_id) REFERENCES ai_model(id),
    CONSTRAINT fk_session_agent FOREIGN KEY (agent_id) REFERENCES custom_agent(id)
);
ALTER TABLE chat_session ADD COLUMN IF NOT EXISTS agent_id BIGINT;
ALTER TABLE chat_session ADD COLUMN IF NOT EXISTS parent_session_id BIGINT;
ALTER TABLE chat_session ADD COLUMN IF NOT EXISTS parent_message_id BIGINT;
COMMENT ON TABLE chat_session IS '聊天会话表';
COMMENT ON COLUMN chat_session.id IS '主键 ID';
COMMENT ON COLUMN chat_session.title IS '会话标题';
COMMENT ON COLUMN chat_session.model_id IS '会话最近一次使用模型 ID';
COMMENT ON COLUMN chat_session.agent_id IS '关联智能体 ID';
COMMENT ON COLUMN chat_session.parent_session_id IS '父会话 ID（复制或分支来源）';
COMMENT ON COLUMN chat_session.parent_message_id IS '分支起点消息 ID';
COMMENT ON COLUMN chat_session.created_at IS '创建时间';
COMMENT ON COLUMN chat_session.updated_at IS '更新时间';
CREATE INDEX IF NOT EXISTS idx_session_updated_at ON chat_session(updated_at);
CREATE INDEX IF NOT EXISTS idx_session_parent ON chat_session(parent_session_id);

-- 消息表：记录消息内容、模型、推理内容、图片等信息
CREATE TABLE IF NOT EXISTS chat_message (
    id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id         BIGINT       NOT NULL,
    role               VARCHAR(20)  NOT NULL,
    content            CLOB,
    tool_calls         CLOB,
    tool_call_id       VARCHAR(100),
    token_usage        INT,
    prompt_tokens      INT,
    completion_tokens  INT,
    cache_read_tokens  INT,
    cache_write_tokens INT,
    cost_usd           DECIMAL(20,10),
    model_id           BIGINT,
    model_name         VARCHAR(200),
    agent_id           BIGINT,
    agent_name         VARCHAR(100),
    agent_avatar_type  VARCHAR(20),
    agent_avatar_value CLOB,
    reasoning_content  CLOB,
    reasoning_duration_ms BIGINT,
    image_urls         CLOB,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_message_session FOREIGN KEY (session_id) REFERENCES chat_session(id) ON DELETE CASCADE
);
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS model_id BIGINT;
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS model_name VARCHAR(200);
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS prompt_tokens INT;
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS completion_tokens INT;
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS cache_read_tokens INT;
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS cache_write_tokens INT;
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS cost_usd DECIMAL(20,10);
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS agent_id BIGINT;
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS agent_name VARCHAR(100);
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS agent_avatar_type VARCHAR(20);
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS agent_avatar_value CLOB;
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS reasoning_content CLOB;
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS reasoning_duration_ms BIGINT;
ALTER TABLE chat_message ADD COLUMN IF NOT EXISTS image_urls CLOB;
COMMENT ON TABLE chat_message IS '聊天消息表';
COMMENT ON COLUMN chat_message.id IS '主键 ID';
COMMENT ON COLUMN chat_message.session_id IS '所属会话 ID';
COMMENT ON COLUMN chat_message.role IS '消息角色：user/assistant/system/tool';
COMMENT ON COLUMN chat_message.content IS '消息正文';
COMMENT ON COLUMN chat_message.tool_calls IS '工具调用 JSON';
COMMENT ON COLUMN chat_message.tool_call_id IS '工具调用 ID';
COMMENT ON COLUMN chat_message.token_usage IS '本条消息 token 用量';
COMMENT ON COLUMN chat_message.prompt_tokens IS '本条消息输入 token 用量';
COMMENT ON COLUMN chat_message.completion_tokens IS '本条消息输出 token 用量';
COMMENT ON COLUMN chat_message.cache_read_tokens IS '本条消息缓存读取 token 用量';
COMMENT ON COLUMN chat_message.cache_write_tokens IS '本条消息缓存写入 token 用量';
COMMENT ON COLUMN chat_message.cost_usd IS '本条消息估算成本（USD）';
COMMENT ON COLUMN chat_message.model_id IS '生成该消息使用的模型 ID';
COMMENT ON COLUMN chat_message.model_name IS '生成该消息使用的模型名称快照';
COMMENT ON COLUMN chat_message.agent_id IS '生成该消息使用的智能体 ID';
COMMENT ON COLUMN chat_message.agent_name IS '生成该消息使用的智能体名称快照';
COMMENT ON COLUMN chat_message.agent_avatar_type IS '生成该消息使用的智能体头像类型快照';
COMMENT ON COLUMN chat_message.agent_avatar_value IS '生成该消息使用的智能体头像内容快照';
COMMENT ON COLUMN chat_message.reasoning_content IS '模型推理内容';
COMMENT ON COLUMN chat_message.reasoning_duration_ms IS '模型推理耗时（毫秒）';
COMMENT ON COLUMN chat_message.image_urls IS '用户上传图片地址或 data URL 列表 JSON';
COMMENT ON COLUMN chat_message.created_at IS '创建时间';
CREATE INDEX IF NOT EXISTS idx_message_session ON chat_message(session_id);
CREATE INDEX IF NOT EXISTS idx_message_session_created ON chat_message(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_message_agent_id ON chat_message(agent_id);
