import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AiController } from "./ai.controller";
import { TriageZodSchema } from "./ai.validation";

const router = Router();

// Customer: describe the problem -> suggested title / priority / skills
router.post(
  "/triage",
  auth(Role.CUSTOMER),
  validateRequest(TriageZodSchema),
  AiController.triageServiceRequest,
);

// Admin (any technician) or technician (own): AI summary of customer feedback
router.get(
  "/technicians/:technicianId/feedback-summary",
  auth(Role.ADMIN, Role.TECHNICIAN),
  AiController.getTechnicianFeedbackSummary,
);

export const AiRoutes = router;
