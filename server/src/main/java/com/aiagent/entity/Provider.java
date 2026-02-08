package com.aiagent.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("provider")
public class Provider {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    private String baseUrl;

    private String apiKey;  // stored encrypted in DB

    private Boolean enabled;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
