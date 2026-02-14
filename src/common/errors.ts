export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>): ApiError =>
  new ApiError(400, "INVALID_ARGUMENT", message, details);

export const unauthorized = (message = "Authentication required"): ApiError =>
  new ApiError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "Forbidden"): ApiError => new ApiError(403, "FORBIDDEN", message);

export const notFound = (message: string): ApiError => new ApiError(404, "NOT_FOUND", message);

export const internalError = (message = "Internal server error"): ApiError =>
  new ApiError(500, "INTERNAL_ERROR", message);
