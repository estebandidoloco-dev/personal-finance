import { z } from 'zod';

type ApiIssue = { path: string; message: string };

export function apiError(code: string, message: string, status: number, issues?: ApiIssue[]) {
  return Response.json(issues ? { code, message, issues } : { code, message }, { status });
}

export function invalidRequest(error: z.ZodError) {
  return apiError('invalid_request', 'La solicitud no es válida.', 400, error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  })));
}

export function mapCategoryMutationError(error: { code?: string; message?: string }) {
  if (error.code === '23503' || error.message?.includes('Parent category')) {
    return apiError('invalid_parent', 'La categoría padre no existe o no está disponible.', 400);
  }
  if (error.code === '23514' && error.message?.includes('cycle')) {
    return apiError('category_cycle', 'La categoría padre produciría un ciclo.', 400);
  }
  if (error.code === '23514' && error.message?.includes('parent')) {
    return apiError('invalid_parent', 'La categoría padre no está disponible.', 400);
  }
  return apiError('invalid_request', 'No se pudo guardar la categoría.', 400);
}