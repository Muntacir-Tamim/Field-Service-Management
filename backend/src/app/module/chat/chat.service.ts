import { randomUUID } from "node:crypto";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
} from "@langchain/core/messages";
import httpStatus from "http-status";
import { redisClient } from "../../lib/redis";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { ANSWER_NODE, chatGraph } from "./chat.graph";
import type {
  IChatResponse,
  ISendChatMessagePayload,
  TStoredMessage,
} from "./chat.interface";
import { textFromContent } from "./chat.utils";

const MAX_STORED_MESSAGES = 10;
const HISTORY_TTL_SECONDS = 60 * 60;

// The user id is part of the key, so nobody can read another user's session by guessing a sessionId.
const historyKey = (sessionId: string, user?: RequestUser) =>
  `chat:session:${user?.userId ?? "anon"}:${sessionId}`;

const getHistory = async (
  sessionId: string,
  user?: RequestUser,
): Promise<TStoredMessage[]> => {
  const raw = await redisClient.get(historyKey(sessionId, user));
  return raw ? (JSON.parse(raw) as TStoredMessage[]) : [];
};

const saveHistory = async (
  sessionId: string,
  history: TStoredMessage[],
  user?: RequestUser,
) => {
  await redisClient.set(
    historyKey(sessionId, user),
    JSON.stringify(history.slice(-MAX_STORED_MESSAGES)),
    { expiration: { type: "EX", value: HISTORY_TTL_SECONDS } },
  );
};

const toMessages = (history: TStoredMessage[]) =>
  history.map((m) =>
    m.role === "human" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );

const graphInput = (
  message: string,
  history: TStoredMessage[],
  user?: RequestUser,
) => ({
  messages: toMessages(history),
  question: message,
  role: user?.role ?? "PUBLIC",
  userId: user?.userId ?? "",
});

const unavailable = (error: unknown) => {
  if (error instanceof AppError) return error;
  console.error("Chat: failed to generate answer", error);
  return new AppError(
    httpStatus.SERVICE_UNAVAILABLE,
    "Chat is temporarily unavailable. Please try again later.",
  );
};

// Normal JSON answer (no streaming)
const sendMessage = async (
  payload: ISendChatMessagePayload,
  user?: RequestUser,
): Promise<IChatResponse> => {
  const sessionId = payload.sessionId ?? randomUUID();
  const history = await getHistory(sessionId, user);

  try {
    const result = await chatGraph.invoke(
      graphInput(payload.message, history, user),
    );
    const answer = result.answer;

    await saveHistory(
      sessionId,
      [
        ...history,
        { role: "human", content: payload.message },
        { role: "ai", content: answer },
      ],
      user,
    );

    return { sessionId, answer };
  } catch (error) {
    throw unavailable(error);
  }
};

// Streaming answer: onToken is called for every piece of text
const streamMessage = async (
  payload: Required<ISendChatMessagePayload>,
  user: RequestUser | undefined,
  onToken: (text: string) => void,
  signal: AbortSignal,
) => {
  const history = await getHistory(payload.sessionId, user);

  try {
    const stream = await chatGraph.stream(
      graphInput(payload.message, history, user),
      { streamMode: "messages", signal },
    );

    let answer = "";
    for await (const [message, metadata] of stream) {
      if (
        metadata.langgraph_node !== ANSWER_NODE ||
        !AIMessageChunk.isInstance(message)
      ) {
        continue;
      }
      const text = textFromContent(message.content);
      if (text) {
        answer += text;
        onToken(text);
      }
    }

    if (!signal.aborted && answer) {
      await saveHistory(
        payload.sessionId,
        [
          ...history,
          { role: "human", content: payload.message },
          { role: "ai", content: answer },
        ],
        user,
      );
    }
  } catch (error) {
    if (signal.aborted) return;
    throw unavailable(error);
  }
};

export const ChatServices = { sendMessage, streamMessage };
