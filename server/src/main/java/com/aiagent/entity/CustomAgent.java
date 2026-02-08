package com.aiagent.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("custom_agent")
public class CustomAgent {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    private String description;

    private String systemPrompt;

    private String avatarType;

    private String avatarValue;

    private Boolean isDefault;

    private Boolean enabled;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
