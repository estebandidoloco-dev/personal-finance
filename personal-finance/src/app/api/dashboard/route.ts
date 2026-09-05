import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api/errors';
import { createClient } from '@/lib/supabase/server';
import { dashboardPeriodSchema, dashboardResponseSchema } from '@/lib/validation/dashboard';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('unauthorized', 'Debes iniciar sesión.', 401);

  const period = dashboardPeriodSchema.safeParse(new URL(request.url).searchParams.get('period') ?? 'this_month');
  if (!period.success) {
    return apiError('invalid_period', 'El periodo seleccionado no es válido.', 400);
  }

  const { data: rpcData, error } = await supabase.rpc('get_dashboard_summary', {
    p_period: period.data,
  });
  if (error) return apiError('invalid_request', 'No se pudo cargar el dashboard.', 500);

  const data: unknown = rpcData;
  const parsed = dashboardResponseSchema.safeParse(data);
  if (!parsed.success) {
    return apiError(
      'invalid_dashboard_response',
      'La respuesta del dashboard no cumple el contrato esperado.',
      500
    );
  }

  return NextResponse.json(parsed.data);
}
