'use client';

import { useState, useRef } from 'react';
import { useSupabase } from '@/components/providers/supabase-provider';
import { FileText, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import Papa from 'papaparse';

interface ParsedRow {
  [key: string]: string | undefined;
  date?: string;
  amount?: string;
  description?: string;
  balance?: string;
  category?: string;
  notes?: string;
}

interface PreviewRow {
  date: string;
  amount: number;
  description: string;
  balance?: number;
  category?: string;
  notes?: string;
}

interface ImportResult {
  success: number;
  errors: Array<{ row: number; error: string; data: ParsedRow }>;
}

export default function ImportPage() {
  const { supabase } = useSupabase();
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'result'>('upload');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({
    date: '',
    amount: '',
    description: '',
    balance: '',
    category: '',
    notes: '',
  });
  const [categories] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setHeaders(results.meta.fields || []);
          setParsedRows(results.data as ParsedRow[]);
          // Auto-mapeo simple
          const autoMap: Record<string, string> = {};
          results.meta.fields?.forEach((h) => {
            const hl = h.toLowerCase();
            if (hl.includes('date') || hl.includes('fecha')) autoMap.date = h;
            else if (
              hl.includes('amount') ||
              hl.includes('importe') ||
              hl.includes('cargo') ||
              hl.includes('abono')
            )
              autoMap.amount = h;
            else if (hl.includes('desc') || hl.includes('concepto') || hl.includes('detalle'))
              autoMap.description = h;
            else if (hl.includes('balance') || hl.includes('saldo')) autoMap.balance = h;
            else if (hl.includes('cat')) autoMap.category = h;
            else if (hl.includes('note') || hl.includes('obs')) autoMap.notes = h;
          });
          setMapping(autoMap);
          setStep('mapping');
        },
        error: (err: Error) => alert('Error parseando CSV: ' + err.message),
      });
    };
    reader.readAsText(f, 'ISO-8859-1'); // Bancos españoles suelen usar esto
  };

  const generatePreview = () => {
    const required = ['date', 'amount', 'description'];
    const missing = required.filter((f) => !mapping[f]);
    if (missing.length) {
      alert('Faltan campos obligatorios: ' + missing.join(', '));
      return;
    }
    const preview = parsedRows.slice(0, 10).map((row) => ({
      date: row[mapping.date] || '',
      amount: parseFloat(String(row[mapping.amount] || '0').replace(/[^\d.-]/g, '')),
      description: row[mapping.description] || '',
      balance: mapping.balance
        ? parseFloat(String(row[mapping.balance] || '0').replace(/[^\d.-]/g, ''))
        : undefined,
      category: mapping.category ? row[mapping.category] : undefined,
      notes: mapping.notes ? row[mapping.notes] : undefined,
    }));
    setPreviewRows(preview);
    setStep('preview');
  };

  const handleImport = async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const validRows = parsedRows
      .map((row) => ({
        date: row[mapping.date] || '',
        amount: parseFloat(String(row[mapping.amount] || '0').replace(/[^\d.-]/g, '')),
        description: row[mapping.description] || '',
        category: mapping.category ? row[mapping.category] : undefined,
        notes: mapping.notes ? row[mapping.notes] : undefined,
      }))
      .filter((r) => r.date && !isNaN(r.amount) && r.description);

    // Resolver categorías por nombre
    const catMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

    const payload = validRows.map((r) => ({
      user_id: user.id,
      account_id: '', // Se pedirá en modal o se usa cuenta por defecto
      category_id: r.category ? catMap.get(r.category.toLowerCase()) || null : null,
      amount: Math.abs(r.amount),
      kind: r.amount < 0 ? ('expense' as const) : ('income' as const),
      currency: 'MXN',
      date: r.date,
      description: r.description,
      notes: r.notes || null,
      source: 'csv' as const,
    }));

    // Para simplificar: pedimos cuenta en un prompt
    const accountId = prompt('ID de cuenta destino (copia de /dashboard):');
    if (!accountId) {
      setLoading(false);
      return;
    }
    payload.forEach((p) => (p.account_id = accountId));

    // P1 TODO: esta escritura directa queda deshabilitada por P0.2. El importador deberá usar
    // una RPC batch que reutilice las mismas primitivas contables atómicas que las operaciones manuales.
    const { data, error } = await supabase.from('transactions').insert(payload).select();
    if (error) {
      setResult({ success: 0, errors: [{ row: 0, error: error.message, data: {} as ParsedRow }] });
    } else {
      setResult({ success: data?.length || 0, errors: [] });
    }
    setStep('result');
    setLoading(false);
  };

  if (step === 'upload') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="mb-6 text-2xl font-bold">Importar CSV</h1>
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center dark:border-gray-600">
          <FileText className="mx-auto mb-4 h-12 w-12 text-gray-400" />
          <p className="mb-2">Arrastra tu extracto bancario CSV aquí</p>
          <p className="mb-4 text-sm text-gray-500">
            Soporta: BBVA, Santander, CaixaBank, Revolut, N26, genérico
          </p>
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
            id="csv-file"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
          >
            Seleccionar archivo
          </button>
        </div>
      </div>
    );
  }

  if (step === 'mapping') {
    const required = ['date', 'amount', 'description'];
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-6 text-2xl font-bold">Mapear columnas</h1>
        <p className="mb-4 text-gray-500">Asocia cada campo requerido con una columna de tu CSV</p>
        <div className="space-y-4 rounded-lg border bg-white p-6 dark:bg-gray-800">
          {required.map((field) => (
            <div key={field}>
              <label className="mb-1 block text-sm font-medium capitalize">{field} *</label>
              <select
                value={mapping[field]}
                onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                className="w-full rounded-md border px-3 py-2"
              >
                <option value="">-- Seleccionar --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {['balance', 'category', 'notes'].map((field) => (
            <div key={field}>
              <label className="mb-1 block text-sm font-medium capitalize">{field}</label>
              <select
                value={mapping[field]}
                onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                className="w-full rounded-md border px-3 py-2"
              >
                <option value="">-- Seleccionar --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-6 flex gap-2">
          <button
            onClick={generatePreview}
            className="flex-1 rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
          >
            Ver vista previa ({parsedRows.length} filas)
          </button>
        </div>
      </div>
    );
  }

  if (step === 'preview') {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="mb-4 text-2xl font-bold">Vista previa (primeras 10 filas)</h1>
        <div className="overflow-x-auto rounded-lg border bg-white dark:bg-gray-800">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="p-3 text-left text-sm">Fecha</th>
                <th className="p-3 text-left text-sm">Importe</th>
                <th className="p-3 text-left text-sm">Descripción</th>
                <th className="p-3 text-left text-sm">Categoría</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i} className="border-t">
                  <td className="p-3 text-sm">{row.date}</td>
                  <td className="p-3 font-mono text-sm">
                    {row.amount.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
                  </td>
                  <td className="p-3 text-sm">{row.description}</td>
                  <td className="p-3 text-sm">{row.category || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setStep('mapping')}
            className="rounded border px-4 py-2 hover:bg-gray-100"
          >
            Volver
          </button>
          <button
            onClick={handleImport}
            disabled={loading}
            className="rounded bg-green-600 px-6 py-2 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : 'Importar'}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'result') {
    return (
      <div className="mx-auto max-w-xl p-6 text-center">
        <div className="mb-4">
          {result!.success > 0 ? (
            <CheckCircle className="mx-auto mb-2 h-16 w-16 text-green-500" />
          ) : (
            <XCircle className="mx-auto mb-2 h-16 w-16 text-red-500" />
          )}
        </div>
        <h2 className="mb-2 text-2xl font-bold">
          {result!.success > 0 ? 'Importación completada' : 'Error en importación'}
        </h2>
        <p className="mb-6 text-gray-600">
          {result!.success} transacciones importadas correctamente
        </p>
        {result!.errors.length > 0 && (
          <div className="max-h-60 overflow-auto rounded bg-red-50 p-4 text-left text-sm text-red-700">
            {result!.errors.map((e, i) => (
              <div key={i}>
                Fila {e.row}: {e.error}
              </div>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              setStep('upload');
              setResult(null);
            }}
            className="rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
          >
            Importar otro archivo
          </button>
          <a href="/dashboard/transactions" className="rounded border px-6 py-2 hover:bg-gray-100">
            Ver transacciones
          </a>
        </div>
      </div>
    );
  }

  return null;
}
