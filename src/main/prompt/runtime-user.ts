import {
  CONTENT_LANGUAGE_RULES,
  SOURCE_MATERIAL_PLANNING_RULES,
  STABLE_HTML_FRAGMENT_PROTOCOL
} from "./shared";
import type { DeckEditScope } from "../tools/types";
import { INDEX_TRANSITION_TYPES } from "../../shared/index-transition";

const hasSourceMaterialCue = (value: string): boolean =>
  /参考文档|源文档|参考资料|源资料|解析.*大纲|建议大纲|每页要点|必须保留|reference[-\s]?document|source[-\s]?document|source[-\s]?material|recommended outline|per-page points|facts\/metrics/i.test(
    value
  );

export function buildPlanningUserPrompt(args: {
  topic: string;
  totalPages: number;
  userMessage: string;
  hasSourceMaterials?: boolean;
}): string {
  const hasExplicitPageHint = /第\s*\d+\s*页|(?:page|slide)\s*\d+/i.test(args.userMessage);
  const sourcePlanningRules = args.hasSourceMaterials || hasSourceMaterialCue(args.userMessage)
    ? SOURCE_MATERIAL_PLANNING_RULES
    : "";
  return [
    `Topic: ${args.topic}`,
    `Target slide count: ${args.totalPages}`,
    `Return exactly ${args.totalPages} slides, no more and no fewer.`,
    hasExplicitPageHint ? "The user provided page/slide hints. Preserve that pagination intent when possible." : "",
    "",
    "Plan each slide title, key points, and layout intent. Use short phrases, not long paragraphs.",
    sourcePlanningRules,
    "Output must be a JSON array. Each item must be exactly { title, keyPoints, layoutIntent }; keyPoints must contain 1-10 strings.",
    `The array length must be exactly ${args.totalPages}.`,
    "User requirements:",
    args.userMessage,
  ].join("\n");
}

export function buildDesignContractUserPrompt(): string {
  return [
    "Generate the unified visual contract only from the style specification in the system prompt.",
    "Do not use the topic, outline, or user requirements for content planning. The design contract is only for visual consistency.",
    "The theme field must describe visual mood, such as calm academic editorial or organic biophilic report. Do not turn it into the deck topic or a slide title.",
  ].join("\n");
}

export function buildEditUserPrompt(args: {
  userMessage: string;
  editScope?: DeckEditScope;
  selectedPageId?: string;
  selectedPageNumber?: number;
  selectedSelector?: string;
  elementTag?: string;
  elementText?: string;
  existingPageIds?: string[];
}): string {
  const isContainerScope = args.editScope === "presentation-container";
  const isDeckScope = args.editScope === "deck";
  const selector = args.selectedSelector?.trim();

  if (isContainerScope) {
    return [
      "Apply the following edit instruction only to the presentation container:",
      "",
      args.userMessage,
      "",
      CONTENT_LANGUAGE_RULES,
      "",
      "Edit scope: presentation-container",
      "Target file: index.html",
      "Do not modify any /<pageId>.html files.",
      "Only set page transitions through set_index_transition(type, durationMs).",
      `Allowed type values: ${INDEX_TRANSITION_TYPES.join(", ")}. durationMs range: 120-1200, except none uses 0.`,
      args.existingPageIds?.length ? `Existing pages: ${args.existingPageIds.join(", ")}` : "",
    ].join("\n");
  }

  const elementDesc =
    args.elementTag
      ? `Target element: <${args.elementTag}>${args.elementText ? `"${args.elementText}"` : ""}`
      : "";

  return [
    isDeckScope
      ? "Apply the following edit instruction to the relevant /<pageId>.html files. You may edit multiple pages, but must not modify index.html:"
      : "Apply the following edit instruction only to the specified page content. Do not modify other pages:",
    "",
    args.userMessage,
    "",
    CONTENT_LANGUAGE_RULES,
    "",
    args.selectedPageId
      ? `Target page: ${args.selectedPageId} (slide ${args.selectedPageNumber ?? "?"})`
      : isDeckScope
        ? "Target pages: all /<pageId>.html files relevant to the instruction"
        : "Target page: all pages",
    selector ? `Target element CSS selector: ${selector}` : "",
    elementDesc ? `Target element description: ${elementDesc}` : "",
    selector || elementDesc
      ? "Location and edit protocol:"
      : "",
    selector || elementDesc
      ? "- First use read_file to inspect the target page HTML source."
      : "",
    selector
      ? `- Search the source with grep for key selector parts such as classes or attributes: ${selector}`
      : "",
    elementDesc
      ? `- Search the source with grep for the element text: ${elementDesc}`
      : "",
    selector || elementDesc
      ? "- Use the selector and element text together to confirm the exact target node in the source."
      : "",
    selector || elementDesc
      ? "- Use edit_file(old_string, new_string) to modify the target node's HTML string directly."
      : "",
    selector || elementDesc
      ? "- old_string must be large enough to be unique in the file; new_string should contain only the modified portion."
      : "",
    selector || elementDesc
      ? "- Modify only the target node's text, classes, or local styles. Do not change surrounding structure."
      : "",
    selector || elementDesc
      ? "- Do not rewrite the whole page, drift unrelated styles, or perform broad global replacements."
      : "",
    !selector && !elementDesc
      ? "Edit strategy:"
      : "",
    !selector && !elementDesc
      ? "- If this is a local change, preserve the existing layout and update only the necessary local part."
      : "",
    !selector && !elementDesc
      ? "- If the user asks for relayout/redesign/restructure, you may rewrite the whole page fragment."
      : "",
    !selector && !elementDesc
      ? "- For full-page rewrites, follow the Stable HTML fragment protocol strictly. Do not rebuild the page shell."
      : "",
    !selector && !elementDesc ? STABLE_HTML_FRAGMENT_PROTOCOL : "",
    args.existingPageIds?.length ? `Existing pages: ${args.existingPageIds.join(", ")}` : "",
  ].join("\n");
}
