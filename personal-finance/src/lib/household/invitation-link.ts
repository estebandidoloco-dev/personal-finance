export type CreatedHouseholdInvitation = {
  invitationId: string;
  token: string;
  invitedEmail: string;
  expiresAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/i;

export function readCreatedHouseholdInvitation(value: unknown, invitedEmail: string): CreatedHouseholdInvitation | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (typeof result.invitation_id !== 'string' || !UUID.test(result.invitation_id)
      || typeof result.invitation_token !== 'string' || !TOKEN.test(result.invitation_token)
      || typeof result.expires_at !== 'string' || Number.isNaN(Date.parse(result.expires_at))) return null;
  return {
    invitationId: result.invitation_id,
    token: result.invitation_token.toLowerCase(),
    invitedEmail,
    expiresAt: result.expires_at,
  };
}

export function buildHouseholdInvitationLink(origin: string, token: string) {
  if (!TOKEN.test(token)) throw new Error('Token de invitación inválido');
  return `${origin.replace(/\/$/, '')}/dashboard/household/invite#token=${token.toLowerCase()}`;
}
