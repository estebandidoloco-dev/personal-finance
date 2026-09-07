export interface ApiErrorResponse {
  code?: string;
  message?: string;
  error?: string;
}

export function readApiError(value: unknown, fallback: string): ApiErrorResponse & { message: string } {
  if (!value || typeof value !== 'object') return { message: fallback };
  const result = value as ApiErrorResponse;
  return {
    code: typeof result.code === 'string' ? result.code : undefined,
    message: typeof result.message === 'string' && result.message.trim()
      ? result.message
      : typeof result.error === 'string' && result.error.trim() ? result.error : fallback,
  };
}
