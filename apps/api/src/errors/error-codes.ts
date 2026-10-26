export const ErrorCodes = {
  BadRequest: "bad_request",
  ValidationFailed: "validation_failed",
  Unauthorized: "unauthorized",
  Forbidden: "forbidden",
  NotFound: "not_found",
  Conflict: "conflict",
  RateLimited: "rate_limited",
  InternalError: "internal_error",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCodes.BadRequest;
    case 401:
      return ErrorCodes.Unauthorized;
    case 403:
      return ErrorCodes.Forbidden;
    case 404:
      return ErrorCodes.NotFound;
    case 409:
      return ErrorCodes.Conflict;
    case 422:
      return ErrorCodes.ValidationFailed;
    case 429:
      return ErrorCodes.RateLimited;
    default:
      return status >= 500 ? ErrorCodes.InternalError : ErrorCodes.BadRequest;
  }
}
