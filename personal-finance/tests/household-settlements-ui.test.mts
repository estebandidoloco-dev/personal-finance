import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('HouseholdSettlementDialog exports component with required form fields and dialog structure', async () => {
  const dialogSource = await source('../src/components/household/HouseholdSettlementDialog.tsx');

  // Verify UI primitives
  assert.match(dialogSource, /import\s*\{[^}]*Dialog[^}]*\}\s*from\s*'@\/components\/ui\/dialog'/);
  assert.match(dialogSource, /import\s*\{[^}]*Input[^}]*\}\s*from\s*'@\/components\/ui\/input'/);
  assert.match(dialogSource, /import\s*\{[^}]*Button[^}]*\}\s*from\s*'@\/components\/ui\/button'/);
  assert.match(dialogSource, /import\s*\{[^}]*Label[^}]*\}\s*from\s*'@\/components\/ui\/label'/);

  // Verify props interface
  assert.match(dialogSource, /export interface HouseholdSettlementDialogProps/);
  assert.match(dialogSource, /open:\s*boolean/);
  assert.match(dialogSource, /onOpenChange:\s*\(open:\s*boolean\)\s*=>\s*void/);
  assert.match(dialogSource, /householdId:\s*string/);
  assert.match(dialogSource, /maxAmount:\s*string/);
  assert.match(dialogSource, /payerName:\s*string/);
  assert.match(dialogSource, /payeeName:\s*string/);
  assert.match(dialogSource, /isPayerYou:\s*boolean/);
  assert.match(dialogSource, /onSuccess:\s*\(\)\s*=>\s*void/);

  // Form inputs
  assert.match(dialogSource, /id="settlement-amount"/);
  assert.match(dialogSource, /id="settlement-date"/);
  assert.match(dialogSource, /id="settlement-notes"/);

  // Amount validations
  assert.match(dialogSource, /normalizeMoneyInput/);
  assert.match(dialogSource, /compareExactMoney\(normalized,\s*'0\.01'\)/);
  assert.match(dialogSource, /compareExactMoney\(normalized,\s*maxAmount\)/);

  // Date defaults & validation
  assert.match(dialogSource, /todayInMexicoCity/);
  assert.match(dialogSource, /isFinancialDate/);

  // API call & idempotency
  assert.match(dialogSource, /fetch\('\/api\/household\/settlements'/);
  assert.match(dialogSource, /crypto\.randomUUID\(\)/);
  assert.match(dialogSource, /readApiError/);

  // Actions
  assert.match(dialogSource, /Confirmar liquidación/);
  assert.match(dialogSource, /Cancelar/);
  assert.match(dialogSource, /household-finance-mutated/);
});

test('Household dashboard page integrates settlement dialog and "Saldar cuenta" button when debt is active', async () => {
  const pageSource = await source('../src/app/dashboard/household/page.tsx');

  assert.match(pageSource, /HouseholdSettlementDialog/);
  assert.match(pageSource, /Saldar cuenta/);
  assert.match(pageSource, /setSettlementOpen\(true\)/);
  assert.match(pageSource, /maxAmount=\{balance\.amount\}/);
  assert.match(pageSource, /payerName=\{balance\.owed_by_user_id === userId \? 'Tú' : otherName\}/);
  assert.match(pageSource, /payeeName=\{balance\.owed_by_user_id === userId \? otherName : 'Tú'\}/);
  assert.match(pageSource, /isPayerYou=\{balance\.owed_by_user_id === userId\}/);
  assert.match(pageSource, /resource\.retry\(\)/);
  assert.match(pageSource, /household-finance-mutated/);
});

test('HouseholdActivityList exposes cancellation with confirmation for non-cancelled settlements', async () => {
  const activitySource = await source('../src/components/household/HouseholdActivityList.tsx');

  assert.match(activitySource, /item\.entry_type === 'settlement'/);
  assert.match(activitySource, /!item\.is_cancelled && !readOnly/);
  assert.match(activitySource, /Cancelar liquidación/);
  assert.match(activitySource, /ConfirmDialog/);
  assert.match(activitySource, /\/api\/household\/settlements\/\$\{cancellingSettlementId\}\/cancel/);
  assert.match(activitySource, /is_cancelled:\s*true/);
  assert.match(activitySource, /household-finance-mutated/);
});
