package com.aiagent.service.tool;

import com.aiagent.service.tool.annotation.AiTool;
import com.aiagent.service.tool.annotation.AiToolMethod;
import com.aiagent.service.tool.annotation.AiToolParam;
import com.aiagent.service.tool.annotation.AiToolResult;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationContext;
import org.springframework.core.annotation.AnnotationUtils;
import org.springframework.stereotype.Component;
import org.springframework.util.ClassUtils;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.temporal.Temporal;
import java.util.*;

/**
 * 注解式工具扫描器。
 * 启动时将 {@link AiTool} + {@link AiToolMethod} 标记的方法转换为 ToolDefinition。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ToolAnnotationScanner {

    private final ApplicationContext applicationContext;
    private final ObjectMapper objectMapper;

    /**
     * 扫描并构建注解工具定义。
     */
    public List<ToolDefinition> scan() {
        Map<String, Object> beans = applicationContext.getBeansWithAnnotation(AiTool.class);
        if (beans.isEmpty()) {
            return List.of();
        }

        List<ToolDefinition> definitions = new ArrayList<>();
        for (Object bean : beans.values()) {
            Class<?> userClass = ClassUtils.getUserClass(bean);
            AiTool toolMeta = AnnotationUtils.findAnnotation(userClass, AiTool.class);
            if (toolMeta == null || !toolMeta.enabled()) {
                continue;
            }

            for (Method method : userClass.getDeclaredMethods()) {
                AiToolMethod methodMeta = AnnotationUtils.findAnnotation(method, AiToolMethod.class);
                if (methodMeta == null || !methodMeta.enabled()) {
                    continue;
                }

                ToolDefinition definition = buildMethodToolDefinition(bean, method, toolMeta, methodMeta);
                definitions.add(definition);
            }
        }

        return List.copyOf(definitions);
    }

    private ToolDefinition buildMethodToolDefinition(Object bean,
                                                     Method method,
                                                     AiTool classMeta,
                                                     AiToolMethod methodMeta) {
        String name = methodMeta.name() == null ? "" : methodMeta.name().trim();
        if (name.isEmpty()) {
            throw new IllegalStateException("工具方法名称不能为空: " + method);
        }

        List<ToolParamMeta> paramMetas = parseParamMetas(method);
        Map<String, Object> schema = buildParametersSchema(paramMetas);
        String description = buildDescription(classMeta, methodMeta, method);

        return new AnnotationToolDefinition(
                name,
                description,
                schema,
                args -> invokeToolMethod(bean, method, paramMetas, args)
        );
    }

    private List<ToolParamMeta> parseParamMetas(Method method) {
        List<ToolParamMeta> metas = new ArrayList<>();
        Parameter[] parameters = method.getParameters();
        for (int i = 0; i < parameters.length; i++) {
            Parameter parameter = parameters[i];
            AiToolParam paramMeta = parameter.getAnnotation(AiToolParam.class);
            if (paramMeta == null) {
                throw new IllegalStateException("工具方法参数缺少 @AiToolParam 标注: " + method);
            }
            String paramName = paramMeta.name() == null ? "" : paramMeta.name().trim();
            if (paramName.isEmpty()) {
                throw new IllegalStateException("工具方法参数名不能为空: " + method);
            }

            metas.add(new ToolParamMeta(
                    paramName,
                    paramMeta.description(),
                    paramMeta.required(),
                    parameter.getType()
            ));
        }
        return metas;
    }

    private String buildDescription(AiTool classMeta, AiToolMethod methodMeta, Method method) {
        String classDesc = classMeta.description() == null ? "" : classMeta.description().trim();
        String methodDesc = methodMeta.description() == null ? "" : methodMeta.description().trim();
        if (methodDesc.isEmpty()) {
            throw new IllegalStateException("工具方法说明不能为空: " + method);
        }

        StringBuilder builder = new StringBuilder();
        if (!classDesc.isEmpty()) {
            builder.append(classDesc).append("；");
        }
        builder.append(methodDesc);

        AiToolResult resultMeta = AnnotationUtils.findAnnotation(method, AiToolResult.class);
        if (resultMeta != null && resultMeta.description() != null && !resultMeta.description().trim().isEmpty()) {
            builder.append("。返回：").append(resultMeta.description().trim());
        }
        return builder.toString();
    }

    private Map<String, Object> buildParametersSchema(List<ToolParamMeta> paramMetas) {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new LinkedHashMap<>();
        List<String> required = new ArrayList<>();

        for (ToolParamMeta paramMeta : paramMetas) {
            Map<String, Object> property = new LinkedHashMap<>();
            property.put("type", mapJsonType(paramMeta.javaType()));
            if (paramMeta.description() != null && !paramMeta.description().trim().isEmpty()) {
                property.put("description", paramMeta.description().trim());
            }
            if (paramMeta.javaType().isEnum()) {
                List<String> enumValues = Arrays.stream(paramMeta.javaType().getEnumConstants())
                        .map(item -> String.valueOf(item))
                        .toList();
                property.put("enum", enumValues);
            }

            properties.put(paramMeta.name(), property);
            if (paramMeta.required()) {
                required.add(paramMeta.name());
            }
        }

        schema.put("properties", properties);
        schema.put("required", required);
        schema.put("additionalProperties", false);
        return schema;
    }

    private String mapJsonType(Class<?> javaType) {
        if (javaType == null) {
            return "string";
        }
        if (javaType.isEnum()
                || CharSequence.class.isAssignableFrom(javaType)
                || Character.class.equals(javaType)
                || char.class.equals(javaType)
                || Temporal.class.isAssignableFrom(javaType)
                || UUID.class.equals(javaType)) {
            return "string";
        }
        if (Boolean.class.equals(javaType) || boolean.class.equals(javaType)) {
            return "boolean";
        }
        if (Integer.class.equals(javaType)
                || int.class.equals(javaType)
                || Long.class.equals(javaType)
                || long.class.equals(javaType)
                || Short.class.equals(javaType)
                || short.class.equals(javaType)
                || Byte.class.equals(javaType)
                || byte.class.equals(javaType)
                || BigInteger.class.equals(javaType)) {
            return "integer";
        }
        if (Number.class.isAssignableFrom(javaType)
                || Double.class.equals(javaType)
                || double.class.equals(javaType)
                || Float.class.equals(javaType)
                || float.class.equals(javaType)
                || BigDecimal.class.equals(javaType)) {
            return "number";
        }
        if (javaType.isArray() || Collection.class.isAssignableFrom(javaType)) {
            return "array";
        }
        if (Map.class.isAssignableFrom(javaType) || Object.class.equals(javaType)) {
            return "object";
        }
        // 复杂对象默认映射为 object，由 ObjectMapper 做结构转换。
        return "object";
    }

    private String invokeToolMethod(Object bean,
                                    Method method,
                                    List<ToolParamMeta> paramMetas,
                                    Map<String, Object> arguments) {
        Object[] invokeArgs = new Object[paramMetas.size()];
        Map<String, Object> safeArgs = arguments == null ? Map.of() : arguments;

        for (int i = 0; i < paramMetas.size(); i++) {
            ToolParamMeta paramMeta = paramMetas.get(i);
            Object rawValue = safeArgs.get(paramMeta.name());
            if (rawValue == null) {
                if (paramMeta.required()) {
                    throw new RuntimeException("缺少必填参数: " + paramMeta.name());
                }
                invokeArgs[i] = null;
                continue;
            }

            try {
                invokeArgs[i] = objectMapper.convertValue(rawValue, paramMeta.javaType());
            } catch (IllegalArgumentException e) {
                throw new RuntimeException("参数类型不匹配: " + paramMeta.name(), e);
            }
        }

        try {
            if (!method.canAccess(bean)) {
                method.setAccessible(true);
            }
            Object result = method.invoke(bean, invokeArgs);
            return normalizeToolResult(result);
        } catch (InvocationTargetException e) {
            Throwable target = e.getTargetException();
            throw new RuntimeException("工具执行失败: " + target.getMessage(), target);
        } catch (Exception e) {
            throw new RuntimeException("工具执行失败: " + e.getMessage(), e);
        }
    }

    private String normalizeToolResult(Object result) {
        if (result == null) {
            return "工具执行完成，无返回内容。";
        }
        if (result instanceof String text) {
            return text;
        }
        try {
            return objectMapper.writeValueAsString(result);
        } catch (JsonProcessingException e) {
            log.warn("工具结果序列化失败，回退为 toString: {}", e.getMessage());
            return String.valueOf(result);
        }
    }

    private record ToolParamMeta(String name,
                                 String description,
                                 boolean required,
                                 Class<?> javaType) {
    }

    private record AnnotationToolDefinition(String name,
                                            String description,
                                            Map<String, Object> parametersSchema,
                                            ToolExecutor executor) implements ToolDefinition {

        @Override
        public String getName() {
            return name;
        }

        @Override
        public String getDescription() {
            return description;
        }

        @Override
        public Map<String, Object> getParametersSchema() {
            return parametersSchema;
        }

        @Override
        public String execute(Map<String, Object> arguments) {
            return executor.execute(arguments);
        }
    }

    @FunctionalInterface
    private interface ToolExecutor {
        String execute(Map<String, Object> arguments);
    }
}

