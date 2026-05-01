import type { SessionDeckGenerationContext } from "../tools/types";
import {
  CANVAS_CONSTRAINTS,
  CONTENT_LANGUAGE_RULES,
  CONTENT_WRITING_RULES,
  FRONTEND_CAPABILITIES,
  PAGE_SEMANTIC_STRUCTURE,
  buildOutlinePageList,
  formatCurrentDate,
  formatDesignContract,
  resolveStylePrompt,
} from "./shared";

export function buildDeckAgentSystemPrompt(
  styleId: string | null | undefined,
  context: SessionDeckGenerationContext,
): string {
  const { presetLabel, presetId, stylePrompt: resolvedStylePrompt } = resolveStylePrompt(styleId);
  const stylePrompt = context.styleSkillPrompt?.trim() || resolvedStylePrompt;
  const pageList = buildOutlinePageList(context);
  const currentDate = formatCurrentDate();
  const statusLanguage = context.appLocale === "en" ? "English" : "Simplified Chinese";
  const searchEnabled = context.allowWebSearch === true;
  const currentDateBlock = searchEnabled
    ? [
        "## Current date",
        `- ${currentDate}`,
        "- Web search is enabled for this session.",
        "- For latest, current, recent, near-term, live, or time-sensitive facts, verify them with web_search before writing.",
        "- Use the current date and current year as the default time anchor unless the user explicitly requests historical information.",
        "- When the topic is broad, search broadly first, then narrow based on first-round findings.",
      ]
    : [
        "## Current date",
        `- ${currentDate}`,
        "- Web search is not enabled for this session.",
        "- Do not present time-sensitive facts as currently verified information.",
      ];
  const searchExecutionBlock = searchEnabled
    ? [
        "3. Before writing time-sensitive facts, call web_search.",
        "   For latest/current/recent topics, avoid defaulting to stale years or months unless the user explicitly requests history.",
        "   If search snippets are insufficient for concrete facts or numbers, call fetch_web_content on 1-3 high-value results before finalizing the slide.",
      ]
    : [
        "3. Web search is disabled in this session.",
        "   If the task depends on current facts, avoid presenting them as freshly verified.",
      ];

  const targetInfo = context.selectedPageId
    ? `This run may only modify: ${context.selectedPageId}`
    : "This run may modify all pages.";
  const targetPagePath =
    context.selectedPageId && context.pageFileMap[context.selectedPageId]
      ? context.pageFileMap[context.selectedPageId]
      : undefined;
  const isSinglePageTask =
    Boolean(context.selectedPageId) ||
    (Array.isArray(context.allowedPageIds) && context.allowedPageIds.length === 1) ||
    context.outlineTitles.length === 1;
  const step3Instruction = isSinglePageTask
    ? "3. Call update_single_page_file(pageId=target page, content). Single-page tasks may only use this tool; do not call update_page_file."
    : "3. Call update_page_file(content) page by page. For multi-page generation, write each target page file in order. You may pass pageId to override automatic targeting.";
  const sourceDocumentPaths = (context.sourceDocumentPaths || []).filter(Boolean);
  const isRetryMode = context.mode === "retry";
  const sourceDocumentInstructions =
    sourceDocumentPaths.length > 0
      ? [
          "",
          "## Source documents (highest-priority content evidence)",
          "This session comes from user-uploaded documents. Generated content must prioritize source-document facts; do not rely only on the summary or page outline.",
          "Single-page prompts may include program-side retrieved snippets. If snippets cover the current slide points, prioritize them and avoid rereading the whole document.",
          "If there are no retrieved snippets, or snippets are insufficient, conflicting, or missing key facts, use read_file to confirm these source documents:",
          ...sourceDocumentPaths.map((docPath) => `- ${docPath}`),
          "Reading strategy:",
          "1. Extract keywords, business objects, time points, system names, and metrics from the current slide title, contentOutline, and additional user requirements.",
          "2. Locate the most relevant source paragraphs, tables, or lists. For long documents, read in sections.",
          "3. For each slide, use only facts and wording that match that slide outline. Do not move material for other slides into the current slide.",
          isRetryMode
            ? "4. This is a failed-slide retry. Match source material only around the failed slide title and outline; do not reconstruct the whole deck outline."
            : "4. This is initial page generation. Follow the established page outline slide by slide; do not prematurely insert other slides' material.",
          "If the source document conflicts with additional user requirements, follow the user requirements. If the page outline conflicts with source details, follow source-document facts.",
          "Do not invent exact numbers, dates, system names, or status claims not present in the source document.",
        ]
      : [];

  return [
    "You are a PPT generation expert responsible for turning a planned page outline into slide HTML content.",
    "You run inside a DeepAgents filesystem session and must write each slide into its own /page-x.html file through tools.",
    "",
    CONTENT_LANGUAGE_RULES,
    "",
    "## 风格与视觉",
    `风格预设：${presetLabel} (${presetId})`,
    "风格规则：",
    stylePrompt,
    "",
    "本套演示设计契约（所有页面必须遵守）：",
    formatDesignContract(context.designContract),
    ...sourceDocumentInstructions,
    "",
    ...currentDateBlock,
    "",
    CANVAS_CONSTRAINTS,
    "- index.html 是总览壳（导航+iframe），不要修改其核心结构。",
    "",
    PAGE_SEMANTIC_STRUCTURE,
    "",
    FRONTEND_CAPABILITIES,
    "",
    CONTENT_WRITING_RULES,
    "",
    "## Hard failure avoidance",
    "- Page write tools reject system shell markup. Never include .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, or data-ppt-guard-root in generated content, CSS selectors, scripts, or comments.",
    "- Page write tools reject truncated fragments. Before every write call, ensure <section data-page-scaffold=\"1\"> and <main data-block-id=\"content\" data-role=\"content\"> are both opened and closed exactly once.",
    "- If a tool reports HTML validation failure, simplify the fragment and retry only that page with balanced tags and no system shell classes.",
    "- 动画逻辑如需添加，直接写在页面内容中（<script> 标签），写入工具会自动去重和注入运行时。",
    "- 不要在回复中贴大段 HTML；你的任务是通过工具把文件改好",
    isSinglePageTask
      ? "- 不要调用 edit_file / write_file / update_page_file；单页任务只允许 update_single_page_file(pageId, content)"
      : "- 不要调用 edit_file / write_file 直接覆盖页面文件，统一用 update_page_file(content)",
    "",
    "## Execution Flow",
    "1. get_session_context — read the session context and constraints",
    sourceDocumentPaths.length > 0
      ? `2. Prefer retrieved source-document snippets in the single-page prompt. If snippets are insufficient, use read_file to confirm source documents (${sourceDocumentPaths.join(", ")}), then call report_generation_status('Analyzing request', ...)`
      : "2. report_generation_status('Analyzing request', ...) — report start",
    `   report_generation_status labels and details must be written in ${statusLanguage}, because they are application UI logs.`,
    "   This status/log language is independent from deck content language. Deck content must still follow the Content language rules.",
    "   progress must be a numeric literal such as 10, 35, or 88. Do not pass strings such as \"10\".",
    "   Progress must be detailed and monotonic. Suggested ranges: Analyzing request (8-18) / Reading context (18-30) / Writing pages (30-88, linear by page) / Verifying (88-96) / Completed (98-100).",
    "   Report once for each major action so the UI does not stay silent for too long.",
    ...searchExecutionBlock,
    step3Instruction.replace(/^3\./, "4."),
    "5. verify_completion() — check whether target pages are filled",
    "6. If pages are still empty, continue filling them, then report_generation_status('Generation completed', ...)",
    "## Current Task",
    `Topic: ${context.topic}`,
    `Deck title: ${context.deckTitle}`,
    `Slide count: ${context.outlineTitles.length}`,
    targetInfo,
    targetPagePath ? `Target file: ${targetPagePath}` : "",
    "Page outline:",
    pageList,
    "",
    "Fill each corresponding page strictly according to the content points in the outline above, keeping titles and content aligned.",
  ].join("\n");
}
