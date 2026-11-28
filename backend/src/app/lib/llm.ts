import { ChatAnthropic } from "@langchain/anthropic";
import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import httpStatus from "http-status";
import config from "../config";
import { AppError } from "../utils/AppError";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const notConfigured = (what: string) =>
  new AppError(
    httpStatus.SERVICE_UNAVAILABLE,
    `AI features are not configured on this server (${what} is missing)`,
  );

// Models are created lazily, so the server still starts when no AI key is set.
let chatModel: BaseChatModel | null = null;

/**
 * Chat model.
 * - ANTHROPIC_API_KEY set  -> Claude (like ai-basic / ai-ml)
 * - otherwise OPENROUTER_API_KEY -> OpenRouter with fallback models (like the healthcare project)
 */
export const getChatModel = (): BaseChatModel => {
  if (chatModel) return chatModel;

  if (config.anthropic_api_key) {
    chatModel = new ChatAnthropic({
      model: config.anthropic_chat_model,
      apiKey: config.anthropic_api_key,
      temperature: 0.2,
      maxRetries: 3,
    });
    return chatModel;
  }

  if (config.openrouter_api_key) {
    const fallbacks = (config.openrouter_fallback_chat_models ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    chatModel = new ChatOpenAI({
      model: config.openrouter_chat_model,
      apiKey: config.openrouter_api_key,
      temperature: 0.2,
      maxRetries: 3,
      modelKwargs: { models: [config.openrouter_chat_model, ...fallbacks] },
      configuration: {
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: {
          "HTTP-Referer": config.frontend_url ?? "http://localhost:3000",
          "X-Title": "Field Service Management",
        },
      },
    });
    return chatModel;
  }

  throw notConfigured("ANTHROPIC_API_KEY or OPENROUTER_API_KEY");
};

type TOpenRouterEmbeddingResponse = {
  data: { embedding: number[]; index: number }[];
};

// Same embeddings client as the healthcare project (OpenRouter /embeddings)
class OpenRouterEmbeddings extends Embeddings {
  private readonly model: string;
  private readonly apiKey: string;

  constructor(model: string, apiKey: string, params: EmbeddingsParams = {}) {
    super(params);
    this.model = model;
    this.apiKey = apiKey;
  }

  private async embed(input: string[]): Promise<number[][]> {
    const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenRouter embeddings failed: ${response.status} ${await response.text()}`,
      );
    }

    const result = (await response.json()) as TOpenRouterEmbeddingResponse;
    return result.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.caller.call(() => this.embed(texts));
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.caller.call(() => this.embed([text]));
    return vector;
  }
}

// Anthropic has no embeddings API, so embeddings always go through OpenRouter.
export const getEmbeddings = () => {
  if (!config.openrouter_api_key) throw notConfigured("OPENROUTER_API_KEY");
  return new OpenRouterEmbeddings(
    config.openrouter_embedding_model,
    config.openrouter_api_key,
    { maxRetries: 3 },
  );
};
