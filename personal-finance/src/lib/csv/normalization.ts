export const CSV_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  rows: 1000,
  columns: 100,
  batch: 100,
  description: 200,
  notes: 2000,
  externalId: 200,
  fileName: 255,
} as const;

export type AmountMode = 'signed' | 'debit_credit' | 'amount_type';
export type DateFormat = 'iso' | 'dmy' | 'mdy';
export type NumberFormat = 'auto' | 'decimal_dot' | 'decimal_comma';
export type TransactionKind = 'income' | 'expense';

export interface RawCsvRow {
  row_number: number;
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  type?: string;
  notes?: string;
  external_id?: string;
}

export interface CsvNormalizationOptions {
  amount_mode: AmountMode;
  date_format: DateFormat;
  number_format: NumberFormat;
}

export interface NormalizedCsvRow {
  row_number: number;
  original: RawCsvRow;
  date: string;
  description: string;
  amount: string;
  kind: TransactionKind;
  notes: string | null;
  external_id: string | null;
}

export interface InvalidCsvRow {
  row_number: number;
  original: RawCsvRow;
  error: string;
}

export type CsvNormalizationResult =
  | { ok: true; row: NormalizedCsvRow }
  | { ok: false; row: InvalidCsvRow };

function normalizeSpaces(value: string) {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function normalizeCsvDate(value: string, format: DateFormat): string {
  const trimmed = value.trim();
  let year: number;
  let month: number;
  let day: number;

  if (format === 'iso') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!match) throw new Error('La fecha debe usar YYYY-MM-DD.');
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (!match) throw new Error(`La fecha debe usar ${format === 'dmy' ? 'DD/MM/YYYY' : 'MM/DD/YYYY'}.`);
    year = Number(match[3]);
    month = Number(format === 'dmy' ? match[2] : match[1]);
    day = Number(format === 'dmy' ? match[1] : match[2]);
  }

  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error('La fecha no existe en el calendario.');
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseUnsignedAmount(value: string, format: NumberFormat): string {
  let cleaned = value.normalize('NFKC').replace(/[\s\u00a0]/gu, '').replace(/[^0-9,.'+-]/gu, '');
  if (!cleaned) throw new Error('El importe está vacío.');

  cleaned = cleaned.replace(/'/g, '');
  if (/[+-]/.test(cleaned)) throw new Error('Este modo requiere un importe sin signo.');

  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const dotCount = (cleaned.match(/\./g) ?? []).length;
  let decimalSeparator: ',' | '.' | null = null;

  if (commaCount > 0 && dotCount > 0) {
    decimalSeparator = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? ',' : '.';
  } else if (commaCount > 0 || dotCount > 0) {
    const separator = commaCount > 0 ? ',' : '.';
    const count = separator === ',' ? commaCount : dotCount;
    const digitsAfter = cleaned.length - cleaned.lastIndexOf(separator) - 1;

    if (format === 'auto') {
      if (count === 1 && digitsAfter === 3) {
        throw new Error(`El importe ${value} es ambiguo; elige la convención decimal.`);
      }
      decimalSeparator = count === 1 && digitsAfter <= 2 ? separator : null;
    } else {
      decimalSeparator = format === 'decimal_comma' ? ',' : '.';
    }
  }

  const groupingSeparator = decimalSeparator === ',' ? '.' : decimalSeparator === '.' ? ',' : null;
  if (groupingSeparator && cleaned.includes(groupingSeparator)) {
    const integerWithGrouping = decimalSeparator ? cleaned.split(decimalSeparator)[0] : cleaned;
    const escapedGrouping = groupingSeparator === '.' ? '\\.' : groupingSeparator;
    if (!new RegExp(`^\\d{1,3}(${escapedGrouping}\\d{3})+$`).test(integerWithGrouping)) {
      throw new Error('El importe contiene una agrupación de miles inválida.');
    }
    cleaned = cleaned.split(groupingSeparator).join('');
  } else if (!decimalSeparator && (cleaned.includes(',') || cleaned.includes('.'))) {
    const separator = cleaned.includes(',') ? ',' : '.';
    const escapedSeparator = separator === '.' ? '\\.' : separator;
    if (!new RegExp(`^\\d{1,3}(${escapedSeparator}\\d{3})+$`).test(cleaned)) {
      throw new Error('El importe contiene una agrupación de miles inválida.');
    }
  }

  if (decimalSeparator) {
    if ((cleaned.match(new RegExp(`\\${decimalSeparator}`, 'g')) ?? []).length > 1) {
      throw new Error('El importe contiene varios separadores decimales.');
    }
    cleaned = cleaned.replace(decimalSeparator, '.');
  } else {
    cleaned = cleaned.replace(/[,.]/g, '');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error('El importe no tiene un formato válido de hasta dos decimales.');
  }

  const [integerPart, decimalPart = ''] = cleaned.split('.');
  const canonical = `${integerPart.replace(/^0+(?=\d)/, '') || '0'}.${decimalPart.padEnd(2, '0')}`;
  if (canonical === '0.00') throw new Error('El importe debe ser mayor que cero.');
  if (integerPart.length > 12) throw new Error('El importe excede el límite permitido.');
  return canonical;
}

function extractSign(value: string) {
  const normalized = value.normalize('NFKC').trim();
  const parenthesized = /^\(.*\)$/.test(normalized);
  const minusCount = (normalized.match(/-/g) ?? []).length;
  const plusCount = (normalized.match(/\+/g) ?? []).length;
  if (minusCount + plusCount > 1 || (parenthesized && (minusCount || plusCount))) {
    throw new Error('El importe contiene signos contradictorios.');
  }
  return {
    negative: parenthesized || minusCount === 1,
    unsigned: normalized.replace(/^\((.*)\)$/u, '$1').replace(/[+-]/g, ''),
  };
}

function mapKind(value: string): TransactionKind {
  const normalized = normalizeSpaces(value).toLowerCase();
  const income = ['income', 'ingreso', 'credit', 'crédito', 'credito', 'abono', 'cr'];
  const expense = ['expense', 'gasto', 'debit', 'débito', 'debito', 'cargo', 'dr'];
  if (income.includes(normalized)) return 'income';
  if (expense.includes(normalized)) return 'expense';
  throw new Error('El tipo no corresponde a ingreso o gasto.');
}

export function normalizeCsvAmount(
  row: RawCsvRow,
  mode: AmountMode,
  format: NumberFormat
): { amount: string; kind: TransactionKind } {
  if (mode === 'signed') {
    const signed = extractSign(row.amount ?? '');
    return {
      amount: parseUnsignedAmount(signed.unsigned, format),
      kind: signed.negative ? 'expense' : 'income',
    };
  }

  if (mode === 'debit_credit') {
    const debit = normalizeSpaces(row.debit ?? '');
    const credit = normalizeSpaces(row.credit ?? '');
    if ((!debit && !credit) || (debit && credit)) {
      throw new Error('Debe existir un importe en débito o crédito, pero no en ambos.');
    }
    return {
      amount: parseUnsignedAmount(debit || credit, format),
      kind: debit ? 'expense' : 'income',
    };
  }

  const signed = extractSign(row.amount ?? '');
  const kind = mapKind(row.type ?? '');
  if (signed.negative) throw new Error('En importe + tipo, el importe debe ser positivo.');
  return { amount: parseUnsignedAmount(signed.unsigned, format), kind };
}

export function normalizeCsvRow(
  row: RawCsvRow,
  options: CsvNormalizationOptions
): CsvNormalizationResult {
  try {
    const description = normalizeSpaces(row.description);
    const notes = normalizeSpaces(row.notes ?? '');
    const externalId = normalizeSpaces(row.external_id ?? '').toLowerCase();
    if (!Number.isInteger(row.row_number) || row.row_number < 1) throw new Error('Número de fila inválido.');
    if (!description || description.length > CSV_LIMITS.description) {
      throw new Error(`La descripción debe tener entre 1 y ${CSV_LIMITS.description} caracteres.`);
    }
    if (notes.length > CSV_LIMITS.notes) throw new Error(`Las notas exceden ${CSV_LIMITS.notes} caracteres.`);
    if (externalId.length > CSV_LIMITS.externalId) {
      throw new Error(`El identificador externo excede ${CSV_LIMITS.externalId} caracteres.`);
    }
    const financial = normalizeCsvAmount(row, options.amount_mode, options.number_format);
    return {
      ok: true,
      row: {
        row_number: row.row_number,
        original: row,
        date: normalizeCsvDate(row.date, options.date_format),
        description,
        amount: financial.amount,
        kind: financial.kind,
        notes: notes || null,
        external_id: externalId || null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      row: {
        row_number: row.row_number,
        original: row,
        error: error instanceof Error ? error.message : 'Fila inválida.',
      },
    };
  }
}

export function normalizeCsvRows(rows: RawCsvRow[], options: CsvNormalizationOptions) {
  const valid: NormalizedCsvRow[] = [];
  const invalid: InvalidCsvRow[] = [];
  for (const row of rows) {
    const result = normalizeCsvRow(row, options);
    if (result.ok) valid.push(result.row);
    else invalid.push(result.row);
  }
  return { valid, invalid };
}

export async function sha256Hex(bytes: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
