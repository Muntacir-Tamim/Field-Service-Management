import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AiServices } from "./ai.service";

const triageServiceRequest = catchAsync(async (req: Request, res: Response) => {
  const result = await AiServices.triageServiceRequest(req.body.description);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Service request suggestion generated successfully",
    data: result,
  });
});

const getTechnicianFeedbackSummary = catchAsync(
  async (req: Request, res: Response) => {
    const result = await AiServices.getTechnicianFeedbackSummary(
      req.params.technicianId as string,
      req.user!,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Feedback summary retrieved successfully",
      data: result,
    });
  },
);

export const AiController = {
  triageServiceRequest,
  getTechnicianFeedbackSummary,
};
