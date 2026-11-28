export interface ISendChatMessagePayload {
  message: string;
  sessionId?: string;
}

export interface IChatResponse {
  sessionId: string;
  answer: string;
}

export type TStoredMessage = { role: "human" | "ai"; content: string };
