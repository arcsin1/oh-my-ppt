# 删除「一键美化」(page-beautify)功能

## A. 整体删除的专属文件(10 个)

主进程 `src/main/edit-jobs/`:
- `page-beautify-job-service.ts`(服务 + 4 个 IPC handler)
- `page-beautify-agent.ts`(美化 agent)
- `page-beautify-prompt.ts`(提示词)
- `page-beautify-screenshot.ts`(多模态截图)

共享类型:
- `src/shared/page-beautify.ts`

专属测试:
- `tests/unit/edit-jobs/page-beautify-agent.test.ts`
- `tests/unit/edit-jobs/page-beautify-job-guard.test.ts`
- `tests/unit/edit-jobs/page-beautify-job-boundary.test.ts`
- `tests/unit/prompt/page-beautify-prompt.test.ts`
- `tests/unit/session/generate-store-page-beautify.test.ts`

## B. 主进程共享文件(删 beautify 片段)

1. `src/main/ipc/index.ts`:删除 L43 import 与 L164 `registerPageBeautifyJobHandlers(...)` 注册
2. `src/main/db/schema.ts` L600:`GenerationRunMode` 联合类型删 `'page-beautify'`
3. `src/main/db/database.ts`:L44/L55 联合成员删除;`normalizeSessionJobRow`(L1107-1116)删 `kind === 'page-beautify'` 分支 —— 历史 DB 行会自动 fallback 为 `'standard'`,无功能影响
4. `src/main/ipc/runtime/session-run-state.ts`:删 `SessionRunMode`(L11)、`SessionRunKind`(L23)、`SessionRunActivityKind`(L30)三个联合成员,及 `runtimeDomainForSessionRun` 中的 `page-beautify` 分支(L99-104)
5. `src/main/generation/generation-window-policy.ts` L13:删 mode 联合成员
6. `src/main/generation/job-manager.ts` L97:删 `activityKind` 联合成员
7. `src/main/presentation/html/page-writer-core.ts` L460:函数 `replacePageContentFragment` 是共享的(保留),仅把错误文案里的「一键美化」改为通用表述

## C. 渲染进程(删 beautify 片段)

1. `lib/ipc.ts`:删 L56 import、L181/L189 联合成员、L950-967 四个封装函数
2. `store/generateStore.ts`:删 `PageBeautifyJob` 接口(L22-30)、state(L139)、actions 声明(L167-175)、初始值(L252)、实现(L308-343)、reset 引用(L574)
3. `shared/pageEditGenerationEvent.ts`:删 `isPageBeautifyGenerationEvent`(L31-36),保留共享的 `matchesActiveJobRun`;`shared/index.ts` L8 删导出
4. `InsertToolRow.tsx`:删触发/取消逻辑(L300-407)与「一键美化」下拉 UI(L755-803)
5. `pages/session-detail.tsx`:删任务恢复(L131/340-360)、进度事件(L577-612/709-712)、完成 toast(L822-828)、失败处理(L893-898)
6. `pages/sessions.tsx`:删 `listActivePageBeautifyRuns` 水合(L172-179)与 activityKind 路由(L240-241)
7. `PreviewStage.tsx`:删画布上的美化进度条(L62-81、L320/342/377-387)
8. `useChatPanelController.ts`:删停止按钮的 beautify 分支(L32/60/71/86、L621-663)
9. 锁定/禁用联动,删 `pageBeautifyJobs`/`isPageBeautifying` 引用:`useWorkspaceRibbonController.ts`、`WorkspaceRibbon.tsx`、`toolbar/types.ts`、`useSessionToolbarController.ts`、`usePageSidebarController.ts`、`BrowseView.tsx`、`MasterWorkbenchPanel.tsx`、`MasterLayoutLibraryDialog.tsx`、`useGenerationNotifications.ts`
10. i18n:`zh.ts` L993-1007、`en.ts` L1039-1055 删 `sessionDetail.pageBeautify*` / `cancelPageBeautify` 文案

## D. 测试调整

- `use-generation-notifications.test.ts`:删两个 page-beautify 用例
- `sessions-page-rendering.test.ts`、`chat-panel-page-scope.test.ts`:删 mock 中的 beautify IPC
- `page-edit-generation-event.test.ts`:删 `isPageBeautifyGenerationEvent` 用例
- `job-coordinator.test.ts` L64、`job-manager.test.ts` L722:测试数据名 `'page-beautify'` 改为 `'page-edit'`
- `deck-progress-stage-bounds.test.ts` L29:改测试描述文案
- `page-beautify-fragment-replace.test.ts`:它测的是共享函数 `replacePageContentFragment`,重命名为 `replace-page-content-fragment.test.ts` 保留

## E. 不动的内容

`CHANGELOG.md` 历史记录、`JobCoordinator`、`attachProductSkillsBackend`、`FREEZE_PAGE_FOR_EXPORT_SCRIPT`、`resources/skills/*`、preload 等共享基础设施全部保留。

## F. 验证

1. `pnpm typecheck`(tsc --noEmit,验证联合类型成员删除后无遗漏引用)
2. `pnpm test` 全量通过
3. grep 确认 `src/`、`tests/` 无 `page-beautify|pageBeautify|PageBeautify|一键美化` 残留