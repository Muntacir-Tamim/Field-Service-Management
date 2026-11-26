// import type { Request, Response } from "express";
// import rateLimit from "express-rate-limit";
// import httpStatus from "http-status";

// // আপনার standard error format অনুযায়ী response
// const handler = (_req: Request, res: Response) => {
//   res.status(httpStatus.TOO_MANY_REQUESTS).json({
//     success: false,
//     message: "Too many requests, please try again later.",
//     errors: [],
//   });
// };

// // সব API-এর জন্য: ১৫ মিনিটে ১০০ request
// export const globalLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   limit: 100,
//   standardHeaders: "draft-8",
//   legacyHeaders: false,
//   handler,
// });

// // login/register/OTP/forgot-password-এর জন্য কড়া: ১৫ মিনিটে ১০টা
// export const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   limit: 10,
//   standardHeaders: "draft-8",
//   legacyHeaders: false,
//   handler,
// });

import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import httpStatus from "http-status";

const handler = (_req: Request, res: Response) => {
  res.status(httpStatus.TOO_MANY_REQUESTS).json({
    success: false,
    message: "Too many requests, please try again later.",
    errors: [],
  });
};

// সব API: ১৫ মিনিটে ১০০০ request (dashboard polling-এর জন্য যথেষ্ট)
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler,
});

// এই endpoint গুলো app নিজে নিজে ডাকে, তাই কড়া limit-এ গোনা হবে না
const SESSION_PATHS = ["/me", "/refresh-token", "/logout"];

// login/register/OTP/forgot-password: ১৫ মিনিটে ২০টা
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skip: (req) => SESSION_PATHS.includes(req.path),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler,
});
