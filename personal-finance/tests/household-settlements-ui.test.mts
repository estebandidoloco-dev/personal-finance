import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('HouseholdSettlementDialog exports component with required form fields, funding sources, and dialog structure', async () => {
  const dialogSource = await source('../src/components/household/HouseholdSettlementDialog.tsx');

  // Verify UI primitives
  assert.match(dialogSource, /import\s*\{[^}]*Dialog[^}]*\}\s*from\s*'@\/components\/ui\/dialog'/);
  assert.match(dialogSource, /import\s*\{[^}]*Input[^}]*\}\s*from\s*'@\/components\/ui\/input'/);
  assert.match(dialogSource, /import\s*\{[^}]*Button[^}]*\}\s*from\s*'@\/components\/ui\/button'/);
  assert.match(dialogSource, /import\s*\{[^}]*Label[^}]*\}\s*from\s*'@\/components\/ui\/label'/);
  assert.match(dialogSource, /import\s*\{[^}]*NativeSelect[^}]*\}\s*from\s*'@\/components\/ui\/native-select'/);

  // Verify props interface
  assert.match(dialogSource, /export interface HouseholdSettlementDialogProps/);
  assert.match(dialogSource, /open:\s*boolean/);
  assert.match(dialogSource, /onOpenChange:\s*\(open:\s*boolean\)\s*=>\s*void/);
  assert.match(dialogSource, /householdId:\s*string/);
  assert.match(dialogSource, /maxAmount:\s*string/);
  assert.match(dialogSource, /payerName:\s*string/);
  assert.match(dialogSource, /payeeName:\s*string/);
  assert.match(dialogSource, /isPayerYou:\s*boolean/);
  assert.match(dialogSource, /accounts\?:/);
  assert.match(dialogSource, /onSuccess:\s*\(\)\s*=>\s*void/);

  // Form inputs
  assert.match(dialogSource, /id="settlement-funding-source"/);
  assert.match(dialogSource, /id="settlement-amount"/);
  assert.match(dialogSource, /id="settlement-date"/);
  assert.match(dialogSource, /id="settlement-notes"/);

  // Funding sources
  assert.match(dialogSource, /value="cash"/);
  assert.match(dialogSource, /value="personal_account"/);
  assert.match(dialogSource, /value="household_account"/);
  assert.match(dialogSource, /value="in_kind"/);
  assert.match(dialogSource, /Efectivo/);
  assert.match(dialogSource, /Mi cuenta personal/);
  assert.match(dialogSource, /Fondo común \(Cuenta compartida\)/);
  assert.match(dialogSource, /En especie/);

  // Account pickers
  assert.match(dialogSource, /id="settlement-source-personal-account"/);
  assert.match(dialogSource, /id="settlement-source-household-account"/);
  assert.match(dialogSource, /\/api\/accounts/);

  // Notice
  assert.match(dialogSource, /Nota: La liquidación quedará pendiente hasta que/);
  assert.match(dialogSource, /confirme haber recibido el dinero/);

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
  assert.match(dialogSource, /funding_source:\s*fundingSource/);
  assert.match(dialogSource, /source_personal_account_id/);
  assert.match(dialogSource, /source_household_account_id/);

  // Actions
  assert.match(dialogSource, /Confirmar liquidación/);
  assert.match(dialogSource, /Cancelar/);
  assert.match(dialogSource, /household-finance-mutated/);
});

test('Household dashboard page integrates settlement dialog, pending settlement confirmation banner, and "Saldar cuenta" button', async () => {
  const pageSource = await source('../src/app/dashboard/household/page.tsx');

  // Integration with settlement dialog
  assert.match(pageSource, /HouseholdSettlementDialog/);
  assert.match(pageSource, /Saldar cuenta/);
  assert.match(pageSource, /setSettlementOpen\(true\)/);
  assert.match(pageSource, /maxAmount=\{balance\.amount\}/);
  assert.match(pageSource, /payerName=\{balance\.owed_by_user_id === userId \? 'Tú' : otherName\}/);
  assert.match(pageSource, /payeeName=\{balance\.owed_by_user_id === userId \? otherName : 'Tú'\}/);
  assert.match(pageSource, /isPayerYou=\{balance\.owed_by_user_id === userId\}/);
  assert.match(pageSource, /accounts=\{accounts\}/);
  assert.match(pageSource, /resource\.retry\(\)/);
  assert.match(pageSource, /household-finance-mutated/);

  // Pending settlement banner & recipient / payer workflows
  assert.match(pageSource, /pending\s*=\s*balance\.pending_settlement/);
  assert.match(pageSource, /isPendingPayee/);
  assert.match(pageSource, /isPendingPayer/);
  assert.match(pageSource, /te envió una liquidación de/);
  assert.match(pageSource, /¿Confirmas haber recibido este dinero\?/);
  assert.match(pageSource, /Confirmar recibido/);
  assert.match(pageSource, /Rechazar/);
  assert.match(pageSource, /Enviaste una liquidación de/);
  assert.match(pageSource, /Pendiente de que confirme de recibido/);
  assert.match(pageSource, /Cancelar envío/);

  // API calls for confirm, reject, and cancel
  assert.match(pageSource, /\/api\/household\/settlements\/\$\{settlementId\}\/confirm/);
  assert.match(pageSource, /\/api\/household\/settlements\/\$\{settlementId\}\/reject/);
  assert.match(pageSource, /\/api\/household\/settlements\/\$\{settlementId\}\/cancel/);

  // Disable / hide "Saldar cuenta" when pending settlement exists
  assert.match(pageSource, /!pending && !even/);
});

test('HouseholdActivityList exposes funding source badges, status badges, and recipient confirmation & cancellation actions', async () => {
  const activitySource = await source('../src/components/household/HouseholdActivityList.tsx');

  assert.match(activitySource, /item\.entry_type === 'settlement'/);
  assert.match(activitySource, /!item\.is_cancelled && !readOnly/);
  assert.match(activitySource, /Cancelar liquidación/);
  assert.match(activitySource, /ConfirmDialog/);
  assert.match(activitySource, /\/api\/household\/settlements\/\$\{cancellingSettlementId\}\/cancel/);
  assert.match(activitySource, /is_cancelled:\s*true/);
  assert.match(activitySource, /household-finance-mutated/);

  // Status badges
  assert.match(activitySource, /Pendiente de confirmación/);
  assert.match(activitySource, /Confirmada/);
  assert.match(activitySource, /Rechazada/);
  assert.match(activitySource, /Cancelada/);

  // Funding source badge
  assert.match(activitySource, /settlementFundingSourceLabel\(item\.funding_source\)/);

  // Payee buttons: Confirmar de recibido & Rechazar
  assert.match(activitySource, /Confirmar de recibido/);
  assert.match(activitySource, /Rechazar/);
  assert.match(activitySource, /\/api\/household\/settlements\/\$\{settlementId\}\/confirm/);
  assert.match(activitySource, /\/api\/household\/settlements\/\$\{rejectingSettlementId\}\/reject/);
});
