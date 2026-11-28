import { randomUUID } from "node:crypto";
import { createSession } from "better-sse";
import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ChatServices } from "./chat.service";

// POST /chat/message -> one JSON answer
const sendMessage = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatServices.sendMessage(req.body, req.user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Chat reply generated successfully",
    data: result,
  });
});

// POST /chat -> Server-Sent Events: "session", many "text", then "done" (or "error")
const streamMessage = async (req: Request, res: Response) => {
  const sessionId: string = req.body.sessionId ?? randomUUID();

  const abort = new AbortController();
  const session = await createSession(req, res);
  session.once("disconnected", () => abort.abort());

  try {
    session.push({ sessionId }, "session");

    await ChatServices.streamMessage(
      { message: req.body.message, sessionId },
      req.user,
      (text) => session.push({ text }, "text"),
      abort.signal,
    );

    if (!abort.signal.aborted) session.push({}, "done");
  } catch (error) {
    if (!abort.signal.aborted) {
      session.push(
        {
          message:
            error instanceof Error
              ? error.message
              : "Failed to generate answer",
        },
        "error",
      );
    }
  } finally {
    if (!res.writableEnded && !res.destroyed) res.end();
  }
};

export const ChatController = { sendMessage, streamMessage };
