import type { BaseMessage } from "@langchain/core/messages";
import {
  END,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";
import { getChatModel } from "../../lib/llm";
import {
  getSkillsText,
  getTechniciansText,
  getUserDataText,
  RESTRICTED_TECHNICIANS_TEXT,
  retrieveTechnicianIds,
} from "./chat.context";
import { CHAT_PROMPT, CONDENSE_PROMPT } from "./chat.prompt";
import { textFromContent } from "./chat.utils";

export const ANSWER_NODE = "generateAnswer" as const;
const MAX_HISTORY_MESSAGES = 20;

// `messages` carries the previous conversation (loaded from Redis by the service).
const State = new StateSchema({
  messages: MessagesValue,
  question: z.string(),
  role: z.string().default("PUBLIC"),
  userId: z.string().default(""),
  searchQuery: z.string().default(""),
  skills: z.string().default(""),
  technicians: z.string().default(RESTRICTED_TECHNICIANS_TEXT),
  userData: z.string().default(""),
  answer: z.string().default(""),
});

type S = typeof State.State;

// 1. Turn a follow-up ("and is he available?") into a standalone search query.
//    Only needed when we really search technicians (ADMIN).
async function condense(state: S) {
  if (state.role !== "ADMIN" || state.messages.length === 0) {
    return { searchQuery: state.question };
  }

  const messages = await CONDENSE_PROMPT.formatMessages({
    history: state.messages.slice(-MAX_HISTORY_MESSAGES) as BaseMessage[],
    question: state.question,
  });
  const result = await getChatModel().invoke(messages);

  return {
    searchQuery: textFromContent(result.content).trim() || state.question,
  };
}

// 2. Gather context. Technician profiles are ADMIN-only (same as the REST API).
async function retrieve(state: S) {
  const [skills, userData] = await Promise.all([
    getSkillsText(),
    getUserDataText(state.role, state.userId || undefined),
  ]);

  let technicians = RESTRICTED_TECHNICIANS_TEXT;
  if (state.role === "ADMIN") {
    const ids = await retrieveTechnicianIds(state.searchQuery);
    technicians = await getTechniciansText(ids);
  }

  return { skills, userData, technicians };
}

// 3. Answer. Tokens of this node are streamed to the client.
async function generateAnswer(state: S) {
  const messages = await CHAT_PROMPT.formatMessages({
    role: state.role,
    skills: state.skills,
    technicians: state.technicians,
    userData: state.userData,
    history: state.messages.slice(-MAX_HISTORY_MESSAGES) as BaseMessage[],
    question: state.question,
  });

  const result = await getChatModel().invoke(messages);
  return { answer: textFromContent(result.content) };
}

export const chatGraph = new StateGraph(State)
  .addNode("condense", condense)
  .addNode("retrieve", retrieve)
  .addNode(ANSWER_NODE, generateAnswer)
  .addEdge(START, "condense")
  .addEdge("condense", "retrieve")
  .addEdge("retrieve", ANSWER_NODE)
  .addEdge(ANSWER_NODE, END)
  .compile();
