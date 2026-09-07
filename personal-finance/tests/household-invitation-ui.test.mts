import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
// @ts-expect-error Node type stripping requires source extensions.
import { buildHouseholdInvitationLink, readCreatedHouseholdInvitation } from '../src/lib/household/invitation-link.ts';

const firstToken = 'a'.repeat(64);
const secondToken = 'b'.repeat(64);
const response = (token: string) => ({
  invitation_id: '00000000-0000-4000-8000-000000000001',
  invitation_token: token,
  expires_at: '2026-09-13T12:00:00.000Z',
});

test('created invitation response produces the approved fragment link', () => {
  const invitation = readCreatedHouseholdInvitation(response(firstToken), 'pareja@example.com');
  assert.ok(invitation);
  assert.equal(
    buildHouseholdInvitationLink('http://localhost:3000/', invitation.token),
    `http://localhost:3000/dashboard/household/invite#token=${firstToken}`,
  );
  assert.equal(buildHouseholdInvitationLink('http://localhost:3000', secondToken).endsWith(secondToken), true);
});

test('setup UI exposes one-time sharing, copy, pending and revoke states without persistence', async () => {
  const source = await readFile(new URL('../src/app/dashboard/household/setup/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /useState<CreatedHouseholdInvitation \| null>\(\s*null\s*\)/);
  assert.match(source, /Invitación creada/);
  assert.match(source, /Invitación pendiente/);
  assert.match(source, /Copiar invitación/);
  assert.match(source, /Enlace copiado/);
  assert.match(source, /solo se muestra una vez/);
  assert.match(source, /El enlace ya no está disponible/);
  assert.match(source, /Revocar invitación/);
  assert.match(source, /setCreatedInvitation\(null\)/);
  assert.match(source, /setCreatedInvitation\(invitation\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|console\./);
  assert.doesNotMatch(source, /currency|service_role|NEXT_PUBLIC_/i);
  assert.doesNotMatch(source, /invite\?token=/);
});

test('fresh state cannot reconstruct a previously returned token', () => {
  assert.equal(readCreatedHouseholdInvitation(null, 'pareja@example.com'), null);
  assert.throws(() => buildHouseholdInvitationLink('http://localhost:3000', ''), /inválido/);
});
