type Request = (url: string, init: RequestInit) => Promise<{ ok: boolean }>;

export async function closeHousehold(householdId: string, request: Request = fetch) {
  const response = await request('/api/household/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ household_id: householdId }),
  });
  if (!response.ok) {
    throw new Error('No pudimos cerrar el espacio. No se realizaron cambios.');
  }
}
