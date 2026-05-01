import { CONTENT_LANGUAGE_RULES, formatCurrentDate } from "./shared";

export function buildPlanningUserPrompt(args: {
  topic: string;
  totalPages: number;
  userMessage: string;
}): string {
  const currentDate = formatCurrentDate();
  const hasExplicitPageHint = /第\s*\d+\s*页|(?:page|slide)\s*\d+/i.test(args.userMessage);
  return [
    `Topic: ${args.topic}`,
    `Current date: ${currentDate}`,
    `Target slide count: ${args.totalPages}`,
    `Return exactly ${args.totalPages} slides, no more and no fewer.`,
    hasExplicitPageHint ? "The user provided page/slide hints. Preserve that pagination intent when possible." : "",
    "If the user mentions latest, current, recent, the last two days, today, this week, this month, live, or news, do not default to stale years or months.",
    "If the user does not explicitly request a historical period, interpret time-sensitive wording using the current date.",
    "",
    "Plan each slide title, key points, and layout intent. Use short phrases, not long paragraphs.",
    "Output must be a JSON array. Each item must be exactly { title, keyPoints, layoutIntent }; keyPoints must contain 1-6 strings.",
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
  editScope?: "main" | "page";
  selectedPageId?: string;
  selectedPageNumber?: number;
  selectedSelector?: string;
  elementTag?: string;
  elementText?: string;
  existingPageIds?: string[];
}): string {
  const isMainScope = args.editScope === "main";
  const selector = args.selectedSelector?.trim();

  if (isMainScope) {
    return [
      "Apply the following edit instruction only to the index.html overview shell:",
      "",
      args.userMessage,
      "",
      CONTENT_LANGUAGE_RULES,
      "",
      "Edit scope: main session",
      "Target file: index.html",
      "Do not modify any page-x.html files.",
      "Only set page transitions through set_index_transition(type, durationMs).",
      "Allowed type values: fade or none. durationMs range: 120-1200.",
      args.existingPageIds?.length ? `Existing pages: ${args.existingPageIds.join(", ")}` : "",
    ].join("\n");
  }

  const elementDesc =
    args.elementTag
      ? `Target element: <${args.elementTag}>${args.elementText ? `"${args.elementText}"` : ""}`
      : "";

  return [
    "Apply the following edit instruction only to the specified page content. Do not modify other pages:",
    "",
    args.userMessage,
    "",
    CONTENT_LANGUAGE_RULES,
    "",
    args.selectedPageId ? `Target page: ${args.selectedPageId} (slide ${args.selectedPageNumber ?? "?"})` : "Target page: all pages",
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
    args.existingPageIds?.length ? `Existing pages: ${args.existingPageIds.join(", ")}` : "",
  ].join("\n");
}
