# 应用中心 (App Center)

应用中心是 Open Zen 的核心模块之一，旨在帮助用户沉淀和复用 AI 生成的高质量代码（如 HTML 网页、工具脚本等）。

## 模块总览

该模块实现了从聊天对话到独立应用的闭环流程：
1. **发现**：AI 在聊天中生成 HTML 或其他可运行代码。
2. **沉淀**：一键保存到应用中心，自动记录来源快照。
3. **编辑**：集成 Monaco Editor，支持实时预览、代码编辑与版本对比。
4. **复用**：支持独立预览页打开，并可随时回溯至产生该应用的原始会话。

## 核心文件清单

### 后端实现
- **Controller**: `server/src/main/java/com/aiagent/controller/AppCenterController.java` — RESTful API 定义
- **Service**: `server/src/main/java/com/aiagent/service/AppCenterService.java` — 核心业务逻辑（去重、图标处理、重置逻辑）
- **Entity**: `server/src/main/java/com/aiagent/entity/AppCenterItem.java` — 数据库映射实体
- **DTO**:
  - `server/src/main/java/com/aiagent/dto/AppCenterItemCreateRequest.java`
  - `server/src/main/java/com/aiagent/dto/AppCenterItemUpdateRequest.java`
  - `server/src/main/java/com/aiagent/dto/AppCenterItemResponse.java`
- **Mapper**: `server/src/main/java/com/aiagent/mapper/AppCenterItemMapper.java`

### 前端实现
- **页面**: `web/src/pages/AppsPage.tsx` — 应用列表、编辑器弹窗、预览逻辑
- **状态管理**: `web/src/store/appCenterStore.ts` — Zustand 状态库
- **接口**: `web/src/api/appCenter.ts` — 后端接口封装
- **交互**: `web/src/pages/ChatPage.tsx` — 聊天页“添加到应用中心”对话框及逻辑

### 数据库
- **表结构**: `app_center_item` (定义见 `server/src/main/resources/schema.sql`)
