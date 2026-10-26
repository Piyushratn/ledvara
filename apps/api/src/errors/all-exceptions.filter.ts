import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./app-error.js";
import { ErrorCodes, codeForStatus } from "./error-codes.js";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.InternalError;
    let message = "Something went wrong. Please try again later.";
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeForStatus(status);
      message = exception.message;
    } else {
      // Unexpected error: log everything, tell the client nothing.
      this.logger.error(
        { requestId: request.id, err: exception },
        "Unhandled exception while processing request",
      );
    }

    const body: ErrorBody = {
      error: { code, message, requestId: String(request.id) },
    };
    if (details !== undefined) {
      body.error.details = details;
    }

    void reply.status(status).send(body);
  }
}
