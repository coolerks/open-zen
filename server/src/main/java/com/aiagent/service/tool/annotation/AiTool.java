package com.aiagent.service.tool.annotation;

import java.lang.annotation.*;

/**
 * 标记一个工具类。
 * 被标记的 Spring Bean 会在启动时被扫描，类中带有 {@link AiToolMethod} 的方法将注册为可调用工具。
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface AiTool {

    /**
     * 工具类分组名，仅用于文档与日志标识，不参与函数名拼接。
     */
    String value() default "";

    /**
     * 工具类说明，会拼接到方法说明前部，帮助模型理解工具职责。
     */
    String description() default "";

    /**
     * 是否启用该工具类。
     */
    boolean enabled() default true;
}

