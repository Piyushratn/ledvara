import { ApiError } from "./http";

/** A message that is safe to show a user. */
export function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "Could not reach the server. Check your connection.";
  return "Something went wrong. Please try again.";
}
