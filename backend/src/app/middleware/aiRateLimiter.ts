import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import httpStatus from "http-status";

const handler = (_req: Request, res: Response) => {
  res.status(httpStatus.TOO_MANY_REQUESTS).json({
    success: false,
    message: "Too many AI requests, please slow down and try again shortly.",
    errors: [],
  });
};

// LLM calls cost money, so this is much stricter than the global limiter.
export const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler,
});
