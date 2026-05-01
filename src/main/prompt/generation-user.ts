import type { DesignContract, SessionDeckGenerationContext } from "../tools/types";
import { formatLayoutIntentPrompt } from "@shared/layout-intent";
import {
  CONTENT_LANGUAGE_RULES,
  FRONTEND_CAPABILITIES,
  PAGE_SEMANTIC_STRUCTURE,
  buildOutlinePageList,
  formatCurrentDate,
  formatDesignContract,
} from "./shared";

export function buildDeckGenerationPrompt(context: SessionDeckGenerationContext): string {
  const pageList = buildOutlinePageList(context);
  return [
    "Use the tools to write the deck content into each /page-x.html according to the user requirements and page outline below:",
    "",
    `Topic: ${context.topic}`,
    `Deck title: ${context.deckTitle}`,
    "Page outline:",
    pageList,
    "",
    "Additional user requirements:",
    context.userMessage,
    "",
    CONTENT_LANGUAGE_RULES,
    "",
    FRONTEND_CAPABILITIES,
    "",
    PAGE_SEMANTIC_STRUCTURE,
    "",
    "Fill each slide strictly according to the content points in the page outline above.",
  ].join("\n");
}

export function buildSinglePageGenerationPrompt(args: {
  topic: string;
  deckTitle: string;
  pageId: string;
  pageNumber: number;
  pageTitle: string;
  pageOutline: string;
  layoutIntent?: SessionDeckGenerationContext["outlineItems"][number]["layoutIntent"];
  allowWebSearch?: boolean;
  sourceDocumentPaths?: string[];
  referenceDocumentSnippets?: string;
  isRetryMode?: boolean;
  designContract?: DesignContract;
  retryContext?: {
    attempt: number;
    maxRetries: number;
    previousError: string;
  };
}): string {
  const currentDate = formatCurrentDate();
  const retryInstructions = args.retryContext
    ? [
        "",
        "Retry fixes to prioritize:",
        `- This is retry ${args.retryContext.attempt}/${args.retryContext.maxRetries}.`,
        `- Previous failure: ${args.retryContext.previousError}`,
        "- Output only the page fragment. It must include section[data-page-scaffold] and main[data-block-id=\"content\"][data-role=\"content\"]. Do not output a full document, page shell, or runtime scripts.",
        "- Before calling the write tool, mentally validate that <section> and <main> are both closed and that no tag is left unfinished at the end.",
        "- If the previous issue was unclosed tags, simplify the structure and ensure every section/div/p/span/li tag is paired.",
        "- If the previous issue was page shell structure, do not include .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, or data-ppt-guard-root anywhere, including CSS selectors, class names, scripts, and comments.",
        "- If the previous issue was animation/chart API usage, use PPT.animate, PPT.createTimeline, PPT.stagger, and PPT.createChart.",
      ]
    : [];
  const sourceDocumentInstructions =
    args.sourceDocumentPaths && args.sourceDocumentPaths.length > 0
      ? args.referenceDocumentSnippets && args.referenceDocumentSnippets.trim().length > 0
        ? [
            "",
            args.referenceDocumentSnippets.trim(),
            "",
            "Source document requirements:",
            "- This slide already has program-side retrieved snippets. Prioritize these snippets when generating slide content.",
            "- If the snippets cover this slide title and content points, you do not need to reread the entire source document.",
            `- If snippets are insufficient, conflicting, or missing key facts, use read_file to confirm the source document: ${args.sourceDocumentPaths.join(", ")}`,
            "- Use only source-document facts directly relevant to this slide outline. Do not move material for other slides into this slide.",
            args.isRetryMode
              ? "- This is a failed-slide retry. Match source material only around this slide title and content points; do not reconstruct the whole deck outline."
              : "",
            "- Do not expand only from the outline. Do not invent exact numbers, dates, system names, or status claims not present in the snippets or source document.",
          ].filter(Boolean)
        : [
            "",
            "Source document requirements:",
            `- No retrieved snippets matched this slide. Before generating the slide, use read_file to read the source document: ${args.sourceDocumentPaths.join(", ")}`,
            "- First extract keywords, business objects, time points, system names, and metrics from this slide title and content points; then match relevant source passages.",
            "- Do not copy the whole document indiscriminately. Use only source-document facts directly relevant to this slide outline.",
            args.isRetryMode
              ? "- This is a failed-slide retry. Match source material only around this slide title and content points; do not reconstruct the whole deck outline."
              : "",
            "- Do not expand only from the outline. Do not invent exact numbers, dates, system names, or status claims not present in the source document.",
          ].filter(Boolean)
      : [];
  const webSearchInstructions = args.allowWebSearch
    ? [
        "",
        `Current date: ${currentDate}`,
        "Web search is enabled for this session.",
        "- For latest, current, recent, near-term, live, news, release, benchmark, ranking, price, version, or other time-sensitive facts, do not write from stale memory first.",
        "- Search first, then write. Use current date and current year as the default time anchor unless the user explicitly requests historical information.",
        "- If the page topic is still broad, start with a broad search to understand the current landscape before narrowing to specific entities.",
        "- If search snippets are not enough to support concrete facts or numbers, call fetch_web_content to inspect the page details before finalizing the slide.",
      ]
    : [];
  return [
    "Generate and write only this slide. Do not modify other slides.",
    "",
    `Topic: ${args.topic}`,
    `Deck title: ${args.deckTitle}`,
    `Target page: ${args.pageId} (slide ${args.pageNumber})`,
    `Slide title: ${args.pageTitle}`,
    `Content points: ${args.pageOutline || "Expand from the topic with moderate information density."}`,
    args.layoutIntent ? formatLayoutIntentPrompt(args.layoutIntent) : "",
    ...webSearchInstructions,
    ...sourceDocumentInstructions,
    "",
    CONTENT_LANGUAGE_RULES,
    "",
    "Deck-wide design contract. Follow it to keep pages visually consistent:",
    formatDesignContract(args.designContract),
    ...retryInstructions,
    "",
    "Expansion rules:",
    "- Treat content points as short seed phrases. Expand each seed into presentable modules such as headings, explanations, lists, charts, comparisons, or conclusions.",
    "- If there are 2-4 points, the final slide should cover all of them. You may add 1-2 supporting information blocks by priority.",
    "- You may complete reasonable data framing, examples, and structure, but do not drift away from the slide title and points.",
    "- Prefer visualization-friendly expression. When points involve trends, comparisons, or proportions, use charts or data cards when appropriate.",
    "",
    "Single-slide tool constraints:",
    "- Call only update_single_page_file(pageId=target page, content). Do not call update_page_file.",
    "- content must be a page fragment with section[data-page-scaffold] and main[data-block-id=\"content\"][data-role=\"content\"].",
    "- The content must not contain <!doctype>, <html>, <head>, <body>, .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, or data-ppt-guard-root.",
    "- The content must be complete and balanced: one opening section with one closing </section>, one opening main with one closing </main>, and no unfinished trailing tags.",
    "- Do not modify other slides.",
  ].join("\n");
}
