import z from "zod";

export const TriageZodSchema = z.object({
  description: z
    .string("Description is required")
    .trim()
    .min(10, "Please describe the problem in at least 10 characters")
    .max(2000, "Description cannot be longer than 2000 characters"),
});
