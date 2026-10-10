# 知识库工作台与 PMPHAI 检索链路

## WeKnora 机构资料检索（2026-09-30）

独立知识库按钮现在进入正式工作台；机构资料由服务端批准清单和WeKnora提供，API位于features/knowledge/api/knowledgeRetrieval.ts，列表与检索经过regionalClient签名。原人卫页面保留在工作台的人卫入口；问诊/语音的PMPHAI分类检索继续使用既有controller。本轮不对ChatPanel或公卫自动注入知识。设计、版本/内容hash门禁及部署见[知识服务设计](../../development-harness/KNOWLEDGE_BASE_DESIGN.md)。


本文档记录当前真实运行的知识库实现。早期 `src/services/knowledgeSearch.ts`、聊天面板自动 RAG 注入、`RENWEI_TOKEN` 配置口径已经不再是当前代码基线。

## 当前职责

| 职责 | 当前文件 |
| --- | --- |
| PMPHAI API / token / 批量检索 / 分类检索 / 原文片段 / 页面 URL / 连接测试 | `src/services/pmphai.ts` |
| 知识库面板、RAG / 列表模式展示、结果详情弹窗 | `src/features/knowledge/ui/KnowledgePanel.vue` |
| 知识库工作台、机构资料检索、人卫页面入口 | `src/features/knowledge/ui/KnowledgeBasePanel.vue`、`api/knowledgeRetrieval.ts`、`model/useInstitutionKnowledgeController.ts`、`model/usePmphaiKnowledgePage.ts` |
| 智能问诊 / 语音问诊共用的批量检索状态 | `src/features/knowledge/model/useKnowledgeSearchController.ts` |
| 诊断、药品、检查分类词提取 | `src/features/knowledge/lib/knowledgeSearchCategories.ts` |
| 语音问诊到知识库 controller 的轻包装 | `src/features/voice-consultation/model/useVoiceKnowledgeSearch.ts` |
| 配置来源 | `floating-ball-server` bootstrap（客户端设置页仅配置服务端地址/机构/设备） |

## 运行链路

1. 启动时从 bootstrap 读取 PMPHAI 启用状态和非敏感能力配置；客户端仅保留 `PMPHAI_SEARCH_MODE` 展示偏好。
2. `pmphaiService` 通过签名服务端接口完成搜索、原文片段获取和页面 URL 生成；凭据与 token 由服务端管理。
3. `ConsultationPage.vue` 和语音问诊分别注入 `isPMPHAIConfigured`、`pmphaiService.searchByCategories`、`pmphaiService.batchSearch` 到 `useKnowledgeSearchController`。
4. `useKnowledgeSearchController` 只管理 loading、结果 Map、面板开合和单项定位，不直接依赖 PMPHAI 单例。
5. `KnowledgePanel.vue` 负责结果展示；RAG 模式展示诊断 / 药品 / 检查分组，列表模式通过 `pmphaiService.listSearch` 查询。

当前 `ChatPanel.vue` 没有接入自动 RAG 注入；如果后续要恢复聊天知识增强，需要先更新 `ARCHITECTURE.md` / `CODE_MAP.md`，再新增明确的聊天侧 controller 或复用现有 knowledge controller。

## PMPHAI 服务接口

常用接口来自 `pmphaiService`：

| 方法 | 用途 |
| --- | --- |
| `search(params)` | 单关键词知识 / 图书 / 图片搜索 |
| `batchSearch(queries, options)` | 多关键词批量搜索，返回 `Map<query, SearchResult[]>` |
| `searchByCategories(diagnoses, medications, examinations, options)` | 按诊断、药品、检查三类批量检索 |
| `getClip(id)` | 获取搜索结果原文片段 |
| `listSearch(params)` | 传统列表搜索 |
| `getPageUrl(params)` | 通过服务端生成 PMPHAI 页面地址 |
| `testConnection()` | 调用服务端知识库连接测试 |

示例：

```typescript
import { pmphaiService, SearchType } from '@services/pmphai';

const results = await pmphaiService.search({
  query: '高血压诊断标准',
  type: SearchType.Knowledge,
  limit: 5,
  enableAbstract: true,
});

const batch = await pmphaiService.searchByCategories(
  ['高血压病'],
  ['苯磺酸氨氯地平片'],
  ['血常规'],
  { trackUsage: true }
);
```

## 服务端托管模式

桌面端不保存 PMPHAI 凭据，启用状态来自 bootstrap：

- `bootstrap.pmphai.enabled`
- `bootstrap.knowledgeBase.enabled`

`pmphaiService` 会通过 `regionalPost` / `regionalGet` 调用远端 `/v1/knowledge/pmphai/*`。新增知识库接口时必须遵守请求签名规则，不得绕过 `regionalClient`。

## 本地偏好与迁移

桌面端仅保留 `PMPHAI_SEARCH_MODE` 作为展示偏好。历史 `PMPHAI_APP_KEY`、`PMPHAI_APP_SECRET`、`PMPHAI_ENABLED`、`KB_APP_KEY`、`KB_APP_SECRET`、`KB_BASE_URL` 在升级时清理，不再作为知识库配置来源。

## 维护约束

1. 智能问诊和语音问诊的分类词提取统一走 `knowledgeSearchCategories.ts`。
2. 面板开合、loading、结果 Map 和单项定位统一走 `useKnowledgeSearchController.ts`。
3. PMPHAI 凭据与 token 只由服务端管理；桌面端 `pmphai.ts` / `knowledgeBase.ts` 仅负责区域接口和 page URL 消费。
4. 新增知识库入口时优先复用 `@features/knowledge` 公开出口，不要重新创建 `knowledgeSearch.ts` 旁路服务。
5. 修改 `/v1/knowledge/pmphai/*` 契约时，同步更新 `api.md`、后端契约和服务端实现。
