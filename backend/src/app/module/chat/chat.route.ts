import { Router } from "express";
import { optionalAuth } from "../../middleware/optionalAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ChatController } from "./chat.controller";
import { SendChatMessageZodSchema } from "./chat.validation";

const router = Router();

// Public endpoints. If the user is logged in, the answer is personalised by role.
router.post(
  "/",
  optionalAuth,
  validateRequest(SendChatMessageZodSchema),
  ChatController.streamMessage,
);

router.post(
  "/message",
  optionalAuth,
  validateRequest(SendChatMessageZodSchema),
  ChatController.sendMessage,
);

export const ChatRoutes = router;
