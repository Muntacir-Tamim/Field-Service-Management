import type { NextFunction, Request, Response } from "express";
import type { JwtPayload } from "jsonwebtoken";
import config from "../config";
import { prisma } from "../lib/prisma";
import { TokenBlacklist } from "../lib/tokenBlacklist";
import { catchAsync } from "../utils/catchAsync";
import { jwtUtils } from "../utils/jwt";

export const optionalAuth = catchAsync(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.accessToken
      ? req.cookies.accessToken
      : req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.split(" ")[1]
        : undefined;

    if (!token) return next();

    try {
      if (await TokenBlacklist.isTokenBlacklisted(token)) return next();

      const verified = jwtUtils.verifyToken(token, config.jwt_access_secret);
      if (!verified.success) return next();

      const { email, name, userId, role } = verified.data as JwtPayload;
      const user = await prisma.user.findFirst({
        where: { id: userId, isDeleted: false, status: "ACTIVE" },
        select: { id: true },
      });

      if (user) req.user = { email, name, userId, role };
    } catch (error) {
      console.error("optionalAuth failed, continuing as anonymous:", error);
    }

    next();
  },
);
