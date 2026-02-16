package com.aiagent.service.tool.annotation;

import java.lang.annotation.*;

/**
 * 标记工具方法参数的声明信息。
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface AiToolParam {

    /**
     * 参数名，会作为 JSON Schema 的 property 名称。
     */
    String name();

    /**
     * 参数说明。
     */
    String description() default "";

    /**
     * 是否必填。
     */
    boolean required() default false;
}

