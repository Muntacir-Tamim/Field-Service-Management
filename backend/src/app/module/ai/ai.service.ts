import { addDays, isAfter } from "date-fns";
import httpStatus from "http-status";
import z from "zod";
import { cacheGetOrSet } from "../../lib/cache";
import { getChatModel } from "../../lib/llm";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { textFromContent } from "../chat/chat.utils";
import { SUMMARIZE_FEEDBACK_PROMPT, TRIAGE_PROMPT } from "./ai.prompt";

const SUMMARY_TTL_DAYS = 7;
const MAX_FEEDBACKS_FOR_SUMMARY = 15;

/* --------------------------------- triage ---------------------------------- */

const TriageOutput = z.object({
  title: z.string().describe("Short title, max 80 characters"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  suggestedSkills: z
    .array(z.string())
    .describe("Up to 3 skill names taken from the skills list"),
  summary: z.string().describe("One sentence for the technician"),
  safetyWarning: z
    .string()
    .nullable()
    .describe("Short safety tip, or null if not dangerous"),
});

const getSkillList = () =>
  cacheGetOrSet("ai:skill-list", 300, () =>
    prisma.skill.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true, category: true },
      orderBy: { name: "asc" },
    }),
  );

// Customer describes a problem -> AI suggests title, priority and skills (to pre-fill the form)
const triageServiceRequest = async (description: string) => {
  const skills = await getSkillList();

  const model = getChatModel().withStructuredOutput(TriageOutput);
  const prompt = await TRIAGE_PROMPT.format({
    skills:
      skills.map((s) => `- ${s.name} [${s.category}]`).join("\n") || "none",
    description,
  });

  let result: z.infer<typeof TriageOutput>;
  try {
    result = await model.invoke(prompt);
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("AI triage failed", error);
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "AI assistant is temporarily unavailable. Please fill the form manually.",
    );
  }

  // never trust the model: only return skills that really exist
  const byName = new Map(skills.map((s) => [s.name.toLowerCase(), s]));
  const matched = result.suggestedSkills
    .map((name) => byName.get(name.trim().toLowerCase()))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .slice(0, 3);

  return {
    title: result.title.slice(0, 80),
    priority: result.priority,
    summary: result.summary,
    safetyWarning: result.safetyWarning,
    suggestedSkills: matched,
  };
};

/* ---------------------------- feedback summary ----------------------------- */

const feedbackWhere = (technicianId: string) => ({
  isDeleted: false,
  serviceRequest: {
    assignments: { some: { technicianId, status: "CONFIRMED" as const } },
  },
});

const getTechnicianFeedbackSummary = async (
  technicianId: string,
  user: RequestUser,
) => {
  const technician = await prisma.technician.findFirst({
    where: { id: technicianId, isDeleted: false },
    select: { id: true, userId: true },
  });
  if (!technician) {
    throw new AppError(httpStatus.NOT_FOUND, "Technician Not Found");
  }
  // a technician may only see the summary of their own feedback
  if (user.role === "TECHNICIAN" && technician.userId !== user.userId) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You can only view your own feedback summary",
    );
  }

  const where = feedbackWhere(technicianId);
  const total = await prisma.customerFeedback.count({ where });

  if (total === 0) {
    return {
      summary: "No feedback yet.",
      feedbackCount: 0,
      generatedAt: null,
      expiresAt: null,
      cached: false,
    };
  }

  const now = new Date();
  const existing = await prisma.technicianFeedbackSummary.findUnique({
    where: { technicianId },
  });

  // reuse while it is not expired AND no new feedback arrived
  if (
    existing &&
    isAfter(existing.expiresAt, now) &&
    existing.feedbackCount === total
  ) {
    return {
      summary: existing.content,
      feedbackCount: existing.feedbackCount,
      generatedAt: existing.generatedAt,
      expiresAt: existing.expiresAt,
      cached: true,
    };
  }

  const feedbacks = await prisma.customerFeedback.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX_FEEDBACKS_FOR_SUMMARY,
    select: { rating: true, comment: true },
  });

  const prompt = await SUMMARIZE_FEEDBACK_PROMPT.format({
    feedback: feedbacks
      .map(
        (f, i) =>
          `${i + 1}. Rating: ${f.rating}/5${f.comment ? `; Comment: ${f.comment}` : "; (no comment)"}`,
      )
      .join("\n"),
  });

  let content: string;
  try {
    content = textFromContent(
      (await getChatModel().invoke(prompt)).content,
    ).trim();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("AI feedback summary failed", error);
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Feedback summary is temporarily unavailable.",
    );
  }
  if (!content) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "The AI returned an empty summary. Please try again.",
    );
  }

  const expiresAt = addDays(now, SUMMARY_TTL_DAYS);
  const saved = await prisma.technicianFeedbackSummary.upsert({
    where: { technicianId },
    create: {
      technicianId,
      content,
      feedbackCount: total,
      generatedAt: now,
      expiresAt,
    },
    update: { content, feedbackCount: total, generatedAt: now, expiresAt },
  });

  return {
    summary: saved.content,
    feedbackCount: saved.feedbackCount,
    generatedAt: saved.generatedAt,
    expiresAt: saved.expiresAt,
    cached: false,
  };
};

export const AiServices = {
  triageServiceRequest,
  getTechnicianFeedbackSummary,
};
