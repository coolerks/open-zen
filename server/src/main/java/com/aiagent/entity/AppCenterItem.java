package com.aiagent.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("app_center_item")
public class AppCenterItem {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    private String iconType;

    private String iconValue;

    private String sourceKey;

    private Long sourceSessionId;

    private String sourceSessionTitle;

    private Long sourceMessageId;

    private Long sourceModelId;

    private String sourceModelName;

    private String language;

    private String codeContent;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
