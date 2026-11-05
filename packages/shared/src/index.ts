export const API_PREFIX = "/api/v1";

export type ApiErrorResponse = {
  error: { code: string; message: string; requestId: string };
};
