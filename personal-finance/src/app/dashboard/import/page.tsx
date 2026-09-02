'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { CheckCircle, FileText, Loader2, XCircle } from 'lucide-react';
import { useSupabase } from '@/components/providers/supabase-provider';
import {
  CSV_LIMITS,
  sha256Hex,
  type AmountMode,
  type DateFormat,
  type NumberFormat,
  type RawCsvRow,
} from '@/lib/csv/normalization';
import { buildCategoryTree, flattenCategoryTree, type CategoryItem } from '@/lib/categories';

type Step = 'upload' | 'mapping' | 'preview' | 'result';
type PreviewStatus = 'valid' | 'invalid' | 'duplicate' | 'possible_duplicate';
interface AccountOption { id: string; name: string; currency: string }
interface PreviewRow {
  row_number: number;
  original: RawCsvRow;
  date?: string;
  description?: string;
  amount?: string;
  kind?: 'income' | 'expense';
  status: PreviewStatus;
  message: string | null;
}
interface ImportSummary { total: number; imported: number; duplicate: number; invalid: number; failed: number }
interface Mapping {
  date: string; description: string; amount: string; debit: string; credit: string;
  type: string; notes: string; external_id: string;
}

const emptyMapping: Mapping = { date: '', description: '', amount: '', debit: '', credit: '', type: '', notes: '', external_id: '' };
const statusStyle: Record<PreviewStatus, string> = {
  valid: 'bg-green-100 text-green-700', invalid: 'bg-red-100 text-red-700',
  duplicate: 'bg-gray-200 text-gray-700', possible_duplicate: 'bg-amber-100 text-amber-800',
};
const statusLabel: Record<PreviewStatus, string> = {
  valid: 'Válida', invalid: 'Inválida', duplicate: 'Duplicada', possible_duplicate: 'Posible duplicada',
};

function autoMapHeaders(headers: string[]): Mapping {
  const result = { ...emptyMapping };
  for (const header of headers) {
    const value = header.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!result.date && /(fecha|date)/.test(value)) result.date = header;
    else if (!result.description && /(descripcion|description|concepto|detalle)/.test(value)) result.description = header;
    else if (!result.external_id && /(^id$|referencia|reference|folio|movement.?id)/.test(value)) result.external_id = header;
    else if (!result.debit && /(debito|debit|cargo)/.test(value)) result.debit = header;
    else if (!result.credit && /(credito|credit|abono)/.test(value)) result.credit = header;
    else if (!result.type && /(tipo|type|kind)/.test(value)) result.type = header;
    else if (!result.notes && /(nota|note|observacion)/.test(value)) result.notes = header;
    else if (!result.amount && /(importe|amount|monto)/.test(value)) result.amount = header;
  }
  return result;
}

export default function ImportPage() {
  const { supabase } = useSupabase();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sourceProvider, setSourceProvider] = useState('generic');
  const [fileName, setFileName] = useState('');
  const [fileHash, setFileHash] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Mapping>(emptyMapping);
  const [amountMode, setAmountMode] = useState<AmountMode>('signed');
  const [dateFormat, setDateFormat] = useState<DateFormat>('iso');
  const [numberFormat, setNumberFormat] = useState<NumberFormat>('auto');
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [importPossible, setImportPossible] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [duplicateFile, setDuplicateFile] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pageSize = 50;

  useEffect(() => {
    async function loadMetadata() {
      const [accountResult, categoryResult] = await Promise.all([
        supabase.from('accounts').select('id, name, currency').order('name'),
        supabase.from('categories').select('id, parent_id, name, type, budget_type, icon, color, is_system, sort_order, user_id').order('name'),
      ]);
      if (accountResult.error || categoryResult.error) return setError('No se pudieron cargar las cuentas o categorías.');
      setAccounts((accountResult.data ?? []) as AccountOption[]);
      setCategories((categoryResult.data ?? []) as CategoryItem[]);
      if (accountResult.data?.length === 1) setAccountId(accountResult.data[0].id);
    }
    void loadMetadata();
  }, [supabase]);

  const rawRows = useMemo<RawCsvRow[]>(() => parsedRows.map((row, index) => ({
    row_number: index + 2,
    date: row[mapping.date] ?? '',
    description: row[mapping.description] ?? '',
    amount: mapping.amount ? row[mapping.amount] ?? '' : undefined,
    debit: mapping.debit ? row[mapping.debit] ?? '' : undefined,
    credit: mapping.credit ? row[mapping.credit] ?? '' : undefined,
    type: mapping.type ? row[mapping.type] ?? '' : undefined,
    notes: mapping.notes ? row[mapping.notes] ?? '' : undefined,
    external_id: mapping.external_id ? row[mapping.external_id] ?? '' : undefined,
  })), [mapping, parsedRows]);

  const requestPayload = () => ({
    account_id: accountId, category_id: categoryId || null, file_name: fileName, file_hash: fileHash,
    source_provider: sourceProvider.trim() || 'generic',
    options: { amount_mode: amountMode, date_format: dateFormat, number_format: numberFormat },
    rows: rawRows, import_possible_duplicate_rows: Array.from(importPossible),
  });

  async function handleFile(file: File) {
    setError('');
    if (file.size > CSV_LIMITS.fileBytes) return setError('El archivo excede el máximo de 5 MiB.');
    try {
      const bytes = await file.arrayBuffer();
      const hash = await sha256Hex(bytes);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
      const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: false, transformHeader: (header) => header.trim() });
      if (result.errors.some((item) => item.code !== 'TooFewFields')) throw new Error(result.errors[0]?.message ?? 'El CSV no pudo analizarse.');
      const fields = result.meta.fields ?? [];
      if (!fields.length || fields.length > CSV_LIMITS.columns) throw new Error('El CSV debe tener entre 1 y 100 columnas.');
      if (!result.data.length || result.data.length > CSV_LIMITS.rows) throw new Error('El CSV debe tener entre 1 y 1000 filas.');
      setFileName(file.name.slice(0, CSV_LIMITS.fileName)); setFileHash(hash); setHeaders(fields);
      setParsedRows(result.data); setMapping(autoMapHeaders(fields)); setStep('mapping');
    } catch (caught) {
      setError(caught instanceof TypeError ? 'El archivo no es UTF-8 válido. Guárdalo como UTF-8 y vuelve a intentarlo.' : caught instanceof Error ? caught.message : 'No se pudo leer el CSV.');
    }
  }

  function validateMapping() {
    if (!accountId) return 'Selecciona una cuenta.';
    if (!mapping.date || !mapping.description) return 'Mapea fecha y descripción.';
    if (amountMode === 'debit_credit' && (!mapping.debit || !mapping.credit)) return 'Mapea débito y crédito.';
    if (amountMode === 'amount_type' && (!mapping.amount || !mapping.type)) return 'Mapea importe y tipo.';
    if (amountMode === 'signed' && !mapping.amount) return 'Mapea el importe con signo.';
    return '';
  }

  async function generatePreview() {
    const mappingError = validateMapping();
    if (mappingError) return setError(mappingError);
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/imports/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestPayload()) });
      const result = (await response.json()) as { error?: string; rows?: PreviewRow[]; duplicate_file?: boolean };
      if (!response.ok || !result.rows) throw new Error(result.error ?? 'No se pudo generar la vista previa.');
      setPreviewRows(result.rows); setDuplicateFile(Boolean(result.duplicate_file)); setImportPossible(new Set()); setPage(0); setStep('preview');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo generar la vista previa.'); }
    finally { setLoading(false); }
  }

  async function runImport() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/imports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestPayload()) });
      const result = (await response.json()) as { error?: string; summary?: ImportSummary; duplicate_file?: boolean };
      if (!response.ok || !result.summary) throw new Error(result.error ?? 'No se pudo completar la importación.');
      setSummary(result.summary); setDuplicateFile(Boolean(result.duplicate_file)); setStep('result');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo completar la importación.'); }
    finally { setLoading(false); }
  }

  function reset() {
    setStep('upload'); setFileName(''); setFileHash(''); setParsedRows([]); setPreviewRows([]);
    setSummary(null); setDuplicateFile(false); setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
  const visibleRows = previewRows.slice(page * pageSize, (page + 1) * pageSize);

  return <div className="mx-auto max-w-7xl p-6">
    <div className="mb-6"><h1 className="text-2xl font-bold">Importar CSV</h1><p className="text-sm text-gray-500">Los movimientos se validan y registran mediante el ledger atómico.</p></div>
    {error && <div className="mb-4 rounded bg-red-100 p-3 text-sm text-red-700">{error}</div>}

    {step === 'upload' && <div className="space-y-5">
      <div className="grid gap-4 rounded-lg border bg-white p-5 dark:bg-gray-800 sm:grid-cols-3">
        <label className="text-sm font-medium">Cuenta<select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">Seleccionar cuenta</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}</select></label>
        <label className="text-sm font-medium">Categoría fija (opcional)<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">Sin categoría</option>{flattenCategoryTree(buildCategoryTree(categories)).map((category) => <option key={category.id} value={category.id}>{'— '.repeat(category.depth)}{category.name}</option>)}</select></label>
        <label className="text-sm font-medium">Banco/proveedor<input value={sourceProvider} onChange={(event) => setSourceProvider(event.target.value)} maxLength={100} className="mt-1 w-full rounded border px-3 py-2" /></label>
      </div>
      <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center dark:border-gray-600"><FileText className="mx-auto mb-4 h-12 w-12 text-gray-400" /><p className="mb-2">Selecciona un CSV UTF-8 de hasta 5 MiB y 1000 filas.</p><p className="mb-4 text-sm text-gray-500">El archivo completo no se almacena.</p><input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); }} /><button onClick={() => fileInputRef.current?.click()} disabled={!accountId} className="rounded bg-blue-600 px-6 py-2 text-white disabled:opacity-50">Seleccionar archivo</button></div>
    </div>}

    {step === 'mapping' && <div className="space-y-5">
      <div className="rounded-lg border bg-white p-5 dark:bg-gray-800"><p className="mb-4 text-sm text-gray-500">{fileName} · {parsedRows.length} filas · SHA-256 {fileHash.slice(0, 12)}…</p><div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-medium">Modelo de importe<select value={amountMode} onChange={(event) => setAmountMode(event.target.value as AmountMode)} className="mt-1 w-full rounded border px-3 py-2"><option value="signed">Importe con signo</option><option value="debit_credit">Débito / crédito</option><option value="amount_type">Importe + tipo</option></select></label>
        <label className="text-sm font-medium">Formato de fecha<select value={dateFormat} onChange={(event) => setDateFormat(event.target.value as DateFormat)} className="mt-1 w-full rounded border px-3 py-2"><option value="iso">YYYY-MM-DD</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option></select></label>
        <label className="text-sm font-medium">Convención numérica<select value={numberFormat} onChange={(event) => setNumberFormat(event.target.value as NumberFormat)} className="mt-1 w-full rounded border px-3 py-2"><option value="auto">Automática (ambiguos inválidos)</option><option value="decimal_dot">Decimal punto</option><option value="decimal_comma">Decimal coma</option></select></label>
      </div></div>
      <div className="grid gap-4 rounded-lg border bg-white p-5 dark:bg-gray-800 sm:grid-cols-2 lg:grid-cols-3">{(Object.keys(mapping) as Array<keyof Mapping>).map((field) => {
        const hidden = (field === 'amount' && amountMode === 'debit_credit') || ((field === 'debit' || field === 'credit') && amountMode !== 'debit_credit') || (field === 'type' && amountMode !== 'amount_type');
        if (hidden) return null;
        const required = ['date', 'description'].includes(field) || (field === 'amount' && amountMode !== 'debit_credit') || ((field === 'debit' || field === 'credit') && amountMode === 'debit_credit') || (field === 'type' && amountMode === 'amount_type');
        return <label key={field} className="text-sm font-medium">{field.replace('_', ' ')}{required ? ' *' : ''}<select value={mapping[field]} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2"><option value="">Sin mapear</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>;
      })}</div>
      <div className="flex gap-2"><button onClick={() => setStep('upload')} className="rounded border px-4 py-2">Volver</button><button onClick={() => void generatePreview()} disabled={loading} className="rounded bg-blue-600 px-6 py-2 text-white disabled:opacity-50">{loading && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}Generar preview</button></div>
    </div>}

    {step === 'preview' && <div className="space-y-4">
      {duplicateFile && <div className="rounded bg-amber-100 p-4 text-sm text-amber-900">Este archivo ya fue procesado para esta cuenta. Confirmarlo importará 0 movimientos nuevos.</div>}
      <div className="rounded border bg-blue-50 p-4 text-sm text-blue-900"><strong>Duplicada</strong> significa coincidencia fuerte por archivo o identificador bancario y se omite. <strong>Posible duplicada</strong> solo es una coincidencia heurística; puedes importarla expresamente.</div>
      <div className="overflow-x-auto rounded-lg border bg-white dark:bg-gray-800"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-gray-50 dark:bg-gray-900"><tr><th className="p-3 text-left">Fila</th><th className="p-3 text-left">Fecha original</th><th className="p-3 text-left">Fecha</th><th className="p-3 text-left">Descripción</th><th className="p-3 text-left">Importe original</th><th className="p-3 text-left">Tipo / importe</th><th className="p-3 text-left">Estado</th><th className="p-3 text-left">Decisión</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.row_number} className="border-t align-top"><td className="p-3">{row.row_number}</td><td className="p-3">{row.original.date}</td><td className="p-3">{row.date ?? '—'}</td><td className="p-3">{row.description ?? row.original.description}</td><td className="p-3 font-mono">{row.original.amount ?? row.original.debit ?? row.original.credit ?? '—'}</td><td className="p-3 font-mono">{row.kind && row.amount ? `${row.kind} ${row.amount}` : '—'}</td><td className="p-3"><span className={`rounded px-2 py-1 text-xs ${statusStyle[row.status]}`}>{statusLabel[row.status]}</span>{row.message && <p className="mt-1 max-w-xs text-xs text-gray-500">{row.message}</p>}</td><td className="p-3">{row.status === 'possible_duplicate' ? <label className="flex items-center gap-2"><input type="checkbox" checked={importPossible.has(row.row_number)} onChange={(event) => setImportPossible((current) => { const next = new Set(current); if (event.target.checked) next.add(row.row_number); else next.delete(row.row_number); return next; })} />Importar de todos modos</label> : 'Automática'}</td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><button disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Anterior</button><span className="px-2 py-2 text-sm">Página {page + 1} de {Math.max(1, Math.ceil(previewRows.length / pageSize))}</span><button disabled={(page + 1) * pageSize >= previewRows.length} onClick={() => setPage((value) => value + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Siguiente</button></div><div className="flex gap-2"><button onClick={() => setStep('mapping')} className="rounded border px-4 py-2">Volver</button><button onClick={() => void runImport()} disabled={loading} className="rounded bg-green-600 px-6 py-2 text-white disabled:opacity-50">{loading && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}Confirmar importación</button></div></div>
    </div>}

    {step === 'result' && summary && <div className="mx-auto max-w-2xl rounded-lg border bg-white p-8 text-center dark:bg-gray-800">{summary.failed === 0 ? <CheckCircle className="mx-auto mb-3 h-14 w-14 text-green-500" /> : <XCircle className="mx-auto mb-3 h-14 w-14 text-red-500" />}<h2 className="text-2xl font-bold">{duplicateFile ? 'Archivo ya procesado' : 'Importación terminada'}</h2><div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded bg-green-50 p-3"><strong className="block text-xl">{summary.imported}</strong>Importadas</div><div className="rounded bg-gray-100 p-3"><strong className="block text-xl">{summary.duplicate}</strong>Duplicadas</div><div className="rounded bg-amber-50 p-3"><strong className="block text-xl">{summary.invalid}</strong>Inválidas</div><div className="rounded bg-red-50 p-3"><strong className="block text-xl">{summary.failed}</strong>Fallidas</div></div><div className="flex justify-center gap-2"><button onClick={reset} className="rounded bg-blue-600 px-5 py-2 text-white">Importar otro</button><a href="/dashboard/transactions" className="rounded border px-5 py-2">Ver transacciones</a></div></div>}
  </div>;
}
