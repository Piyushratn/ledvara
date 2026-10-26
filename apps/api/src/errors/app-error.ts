import { HttpException } from "@nestjs/common";
import type { ErrorCode } from "./error-codes.js";

export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: ErrorCode | string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, status);
  }
}
