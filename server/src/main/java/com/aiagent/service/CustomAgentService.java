package com.aiagent.service;

import com.aiagent.dto.AgentRequest;
import com.aiagent.dto.AgentResponse;
import com.aiagent.entity.CustomAgent;
import com.aiagent.mapper.CustomAgentMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class CustomAgentService {

    private static final String DEFAULT_AGENT_NAME = "默认";
    private static final String AVATAR_TYPE_EMOJI = "emoji";
    private static final String AVATAR_TYPE_IMAGE = "image";

    private static final String DEFAULT_AGENT_PROMPT = """
            你是默认智能体。请使用中文回复，遵循以下原则：
            1. 先准确理解用户意图，再给出结构化、可执行的答案。
            2. 对不确定的信息明确说明假设，不编造事实。
            3. 回答尽量简洁清晰；在复杂问题中先给结论，再给关键步骤。
            4. 涉及代码时优先给可直接运行的示例，并说明输入输出与边界情况。
            5. 保持专业、礼貌、务实的语气。
            """;

    private final CustomAgentMapper customAgentMapper;

    public List<AgentResponse> listAll() {
        ensureDefaultAgentExists();
        return customAgentMapper.selectList(
                        new LambdaQueryWrapper<CustomAgent>()
                                .orderByDesc(CustomAgent::getIsDefault)
                                .orderByDesc(CustomAgent::getUpdatedAt))
                .stream()
                .map(this::toResponse)
                .toList();
    }

    public List<AgentResponse> listEnabled() {
        ensureDefaultAgentExists();
        return customAgentMapper.selectList(
                        new LambdaQueryWrapper<CustomAgent>()
                                .eq(CustomAgent::getEnabled, true)
                                .orderByDesc(CustomAgent::getIsDefault)
                                .orderByAsc(CustomAgent::getName))
                .stream()
                .map(this::toResponse)
                .toList();
    }

    public AgentResponse getById(Long id) {
        return toResponse(getEntityById(id));
    }

    public CustomAgent getEntityById(Long id) {
        CustomAgent agent = customAgentMapper.selectById(id);
        if (agent == null) {
            throw new RuntimeException("智能体不存在: " + id);
        }
        return agent;
    }

    /**
     * 获取系统默认智能体，不存在时自动创建。
     */
    public CustomAgent getDefaultAgentEntity() {
        return ensureDefaultAgentExists();
    }

    public AgentResponse create(AgentRequest request) {
        ensureDefaultAgentExists();
        validateCustomAgentName(request.getName());

        CustomAgent agent = new CustomAgent();
        agent.setName(request.getName().trim());
        agent.setDescription(request.getDescription());
        agent.setSystemPrompt(request.getSystemPrompt());
        applyAvatar(agent, request);
        agent.setIsDefault(false);
        agent.setEnabled(request.getEnabled());
        agent.setCreatedAt(LocalDateTime.now());
        agent.setUpdatedAt(LocalDateTime.now());
        customAgentMapper.insert(agent);
        return toResponse(agent);
    }

    public AgentResponse update(Long id, AgentRequest request) {
        ensureDefaultAgentExists();

        CustomAgent agent = getEntityById(id);
        boolean isDefault = Boolean.TRUE.equals(agent.getIsDefault());

        if (isDefault) {
            // 默认智能体固定名称且必须可用，仅允许修改提示词与描述。
            agent.setName(DEFAULT_AGENT_NAME);
            agent.setDescription(request.getDescription());
            agent.setSystemPrompt(request.getSystemPrompt());
            applyAvatar(agent, request);
            agent.setEnabled(true);
        } else {
            validateCustomAgentName(request.getName());
            agent.setName(request.getName().trim());
            agent.setDescription(request.getDescription());
            agent.setSystemPrompt(request.getSystemPrompt());
            applyAvatar(agent, request);
            agent.setEnabled(request.getEnabled());
        }

        agent.setUpdatedAt(LocalDateTime.now());
        customAgentMapper.updateById(agent);
        return toResponse(agent);
    }

    public void toggleEnabled(Long id, boolean enabled) {
        ensureDefaultAgentExists();

        CustomAgent agent = getEntityById(id);
        if (Boolean.TRUE.equals(agent.getIsDefault()) && !enabled) {
            throw new RuntimeException("默认智能体不允许禁用");
        }

        agent.setEnabled(enabled);
        agent.setUpdatedAt(LocalDateTime.now());
        customAgentMapper.updateById(agent);
    }

    public void delete(Long id) {
        ensureDefaultAgentExists();

        CustomAgent agent = getEntityById(id);
        if (Boolean.TRUE.equals(agent.getIsDefault())) {
            throw new RuntimeException("默认智能体不允许删除");
        }
        customAgentMapper.deleteById(id);
    }

    private CustomAgent ensureDefaultAgentExists() {
        List<CustomAgent> allAgents = customAgentMapper.selectList(
                new LambdaQueryWrapper<CustomAgent>().orderByAsc(CustomAgent::getId)
        );

        // 只允许存在一个系统默认智能体：优先保留已有默认，否则复用同名“默认”，最后再创建。
        CustomAgent keeper = allAgents.stream()
                .filter(agent -> Boolean.TRUE.equals(agent.getIsDefault()))
                .findFirst()
                .orElseGet(() -> allAgents.stream()
                        .filter(agent -> DEFAULT_AGENT_NAME.equals(agent.getName()))
                        .findFirst()
                        .orElse(null));

        if (keeper == null) {
            CustomAgent created = new CustomAgent();
            created.setName(DEFAULT_AGENT_NAME);
            created.setDescription("系统内置默认智能体");
            created.setSystemPrompt(DEFAULT_AGENT_PROMPT);
            created.setIsDefault(true);
            created.setEnabled(true);
            created.setCreatedAt(LocalDateTime.now());
            created.setUpdatedAt(LocalDateTime.now());
            customAgentMapper.insert(created);
            return created;
        }

        boolean keeperChanged = false;
        if (!DEFAULT_AGENT_NAME.equals(keeper.getName())) {
            keeper.setName(DEFAULT_AGENT_NAME);
            keeperChanged = true;
        }
        if (!Boolean.TRUE.equals(keeper.getEnabled())) {
            keeper.setEnabled(true);
            keeperChanged = true;
        }
        if (!Boolean.TRUE.equals(keeper.getIsDefault())) {
            keeper.setIsDefault(true);
            keeperChanged = true;
        }
        if (keeper.getSystemPrompt() == null || keeper.getSystemPrompt().isBlank()) {
            keeper.setSystemPrompt(DEFAULT_AGENT_PROMPT);
            keeperChanged = true;
        }
        if (keeperChanged) {
            keeper.setUpdatedAt(LocalDateTime.now());
            customAgentMapper.updateById(keeper);
        }

        for (CustomAgent agent : allAgents) {
            if (agent.getId().equals(keeper.getId())) {
                continue;
            }

            boolean changed = false;
            // 其余智能体不允许继续保留“默认”名称，避免前端出现两个“默认”选项。
            if (DEFAULT_AGENT_NAME.equals(agent.getName())) {
                agent.setName("默认-自定义" + agent.getId());
                changed = true;
            }
            if (Boolean.TRUE.equals(agent.getIsDefault())) {
                agent.setIsDefault(false);
                changed = true;
            }

            if (changed) {
                agent.setUpdatedAt(LocalDateTime.now());
                customAgentMapper.updateById(agent);
            }
        }

        return keeper;
    }

    private void validateCustomAgentName(String name) {
        if (name == null || name.trim().isBlank()) {
            throw new RuntimeException("智能体名称不能为空");
        }
        if (DEFAULT_AGENT_NAME.equals(name.trim())) {
            throw new RuntimeException("名称“默认”为系统保留名称，请使用其他名称");
        }
    }

    /**
     * 应用头像设置：
     * - type 为空时清空头像
     * - 仅允许 emoji/image 两种类型
     */
    private void applyAvatar(CustomAgent agent, AgentRequest request) {
        String avatarType = request.getAvatarType() == null ? null : request.getAvatarType().trim().toLowerCase();
        String avatarValue = request.getAvatarValue() == null ? null : request.getAvatarValue().trim();

        if (avatarType == null || avatarType.isBlank()) {
            agent.setAvatarType(null);
            agent.setAvatarValue(null);
            return;
        }

        if (!AVATAR_TYPE_EMOJI.equals(avatarType) && !AVATAR_TYPE_IMAGE.equals(avatarType)) {
            throw new RuntimeException("头像类型不合法，仅支持 emoji 或 image");
        }

        if (avatarValue == null || avatarValue.isBlank()) {
            throw new RuntimeException("头像内容不能为空");
        }

        agent.setAvatarType(avatarType);
        agent.setAvatarValue(avatarValue);
    }

    private AgentResponse toResponse(CustomAgent agent) {
        AgentResponse response = new AgentResponse();
        response.setId(agent.getId());
        response.setName(agent.getName());
        response.setDescription(agent.getDescription());
        response.setSystemPrompt(agent.getSystemPrompt());
        response.setAvatarType(agent.getAvatarType());
        response.setAvatarValue(agent.getAvatarValue());
        response.setIsDefault(Boolean.TRUE.equals(agent.getIsDefault()));
        response.setEnabled(agent.getEnabled());
        response.setCreatedAt(agent.getCreatedAt());
        response.setUpdatedAt(agent.getUpdatedAt());
        return response;
    }
}
