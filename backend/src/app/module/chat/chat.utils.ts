import type { MessageContent } from "@langchain/core/messages";

// Same helper as ai-ml: LLM content can be a string or an array of blocks.
export function textFromContent(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("");
}
