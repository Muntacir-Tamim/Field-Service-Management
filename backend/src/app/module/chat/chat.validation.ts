import z from "zod";

export const SendChatMessageZodSchema = z.object({
  message: z
    .string("Message is required")
    .trim()
    .min(1, "Message cannot be empty")
    .max(1000, "Message cannot be longer than 1000 characters"),
  sessionId: z.uuid("Session id must be a valid UUID").optional(),
});
