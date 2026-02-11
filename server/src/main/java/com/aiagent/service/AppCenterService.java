package com.aiagent.service;

import com.aiagent.dto.AppCenterItemCreateRequest;
import com.aiagent.dto.AppCenterItemResponse;
import com.aiagent.dto.AppCenterItemUpdateRequest;
import com.aiagent.entity.AppCenterItem;
import com.aiagent.mapper.AppCenterItemMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class AppCenterService {

    private static final String ICON_TYPE_EMOJI = "emoji";
    private static final String ICON_TYPE_IMAGE = "image";

    private final AppCenterItemMapper appCenterItemMapper;

    public List<AppCenterItemResponse> listAll() {
        return appCenterItemMapper.selectList(
                        new LambdaQueryWrapper<AppCenterItem>()
                                .orderByDesc(AppCenterItem::getUpdatedAt)
                                .orderByDesc(AppCenterItem::getId)
                ).stream()
                .map(this::toResponse)
                .toList();
    }

    public AppCenterItemResponse getById(Long id) {
        return toResponse(getEntityById(id));
    }

    public AppCenterItemResponse create(AppCenterItemCreateRequest request) {
        String normalizedSourceKey = normalizeText(request.getSourceKey());
        // 先做一次业务层去重，减少唯一索引异常噪声。
        if (existsBySourceKey(normalizedSourceKey)) {
            throw new RuntimeException("该代码块已添加到应用中心");
        }

        AppCenterItem item = new AppCenterItem();
        item.setName(normalizeText(request.getName()));
        item.setSourceKey(normalizedSourceKey);
        item.setSourceSessionId(normalizePositiveLong(request.getSourceSessionId()));
        item.setSourceSessionTitle(normalizeText(request.getSourceSessionTitle()));
        item.setSourceMessageId(normalizePositiveLong(request.getSourceMessageId()));
        item.setSourceModelId(normalizePositiveLong(request.getSourceModelId()));
        item.setSourceModelName(normalizeText(request.getSourceModelName()));
        item.setLanguage(normalizeText(request.getLanguage()));
        item.setCodeContent(request.getCodeContent());
        applyIcon(item, request.getIconType(), request.getIconValue());
        item.setCreatedAt(LocalDateTime.now());
        item.setUpdatedAt(LocalDateTime.now());

        try {
            // 最终依赖数据库唯一索引兜底，确保同一代码块不会被并发重复保存。
            appCenterItemMapper.insert(item);
        } catch (DuplicateKeyException exception) {
            throw new RuntimeException("该代码块已添加到应用中心");
        }

        return toResponse(item);
    }

    public AppCenterItemResponse update(Long id, AppCenterItemUpdateRequest request) {
        AppCenterItem item = getEntityById(id);
        item.setName(normalizeText(request.getName()));
        applyIcon(item, request.getIconType(), request.getIconValue());
        item.setUpdatedAt(LocalDateTime.now());
        appCenterItemMapper.updateById(item);
        return toResponse(item);
    }

    public void delete(Long id) {
        AppCenterItem item = getEntityById(id);
        appCenterItemMapper.deleteById(item.getId());
    }

    private AppCenterItem getEntityById(Long id) {
        AppCenterItem item = appCenterItemMapper.selectById(id);
        if (item == null) {
            throw new RuntimeException("应用不存在: " + id);
        }
        return item;
    }

    private boolean existsBySourceKey(String sourceKey) {
        return appCenterItemMapper.selectCount(
                new LambdaQueryWrapper<AppCenterItem>().eq(AppCenterItem::getSourceKey, sourceKey)
        ) > 0;
    }

    private void applyIcon(AppCenterItem item, String iconType, String iconValue) {
        String normalizedIconType = normalizeText(iconType);
        String normalizedIconValue = normalizeText(iconValue);

        if (normalizedIconType == null || normalizedIconValue == null) {
            item.setIconType(null);
            item.setIconValue(null);
            return;
        }

        if (!ICON_TYPE_EMOJI.equals(normalizedIconType) && !ICON_TYPE_IMAGE.equals(normalizedIconType)) {
            throw new RuntimeException("图标类型仅支持 emoji 或 image");
        }

        item.setIconType(normalizedIconType);
        item.setIconValue(normalizedIconValue);
    }

    private String normalizeText(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private Long normalizePositiveLong(Long value) {
        if (value == null || value <= 0) {
            return null;
        }
        return value;
    }

    private AppCenterItemResponse toResponse(AppCenterItem item) {
        AppCenterItemResponse response = new AppCenterItemResponse();
        response.setId(item.getId());
        response.setName(item.getName());
        response.setIconType(item.getIconType());
        response.setIconValue(item.getIconValue());
        response.setSourceKey(item.getSourceKey());
        response.setSourceSessionId(item.getSourceSessionId());
        response.setSourceSessionTitle(item.getSourceSessionTitle());
        response.setSourceMessageId(item.getSourceMessageId());
        response.setSourceModelId(item.getSourceModelId());
        response.setSourceModelName(item.getSourceModelName());
        response.setLanguage(item.getLanguage());
        response.setCodeContent(item.getCodeContent());
        response.setCreatedAt(item.getCreatedAt());
        response.setUpdatedAt(item.getUpdatedAt());
        return response;
    }
}
