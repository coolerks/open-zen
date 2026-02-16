package com.aiagent.service.tool.annotation;

import java.lang.annotation.*;

/**
 * 标记工具方法返回值说明。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface AiToolResult {

    /**
     * 返回值说明，会附加到函数描述中。
     */
    String description() default "";
}

