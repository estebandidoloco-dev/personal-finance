-- P1.2: category and metadata changes must not invoke accounting maintenance.
drop trigger transactions_maintain_account_balance on public.transactions;

create trigger transactions_maintain_account_balance
  after insert or delete or update of account_id, amount, kind, status
  on public.transactions
  for each row execute function private.maintain_account_balance_from_ledger();