package com.aiagent.service.tool.annotation;

import java.lang.annotation.*;

/**
 * 标记一个具体的工具方法。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface AiToolMethod {

    /**
     * 工具函数名。必须全局唯一，会直接发送给大模型。
     */
    String name();

    /**
     * 工具函数说明。
     */
    String description();

    /**
     * 是否启用该方法。
     */
    boolean enabled() default true;
}

