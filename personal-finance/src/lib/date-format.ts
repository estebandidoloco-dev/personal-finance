export function parseDate(dateStr: string): { year: number; month: number; day: number } | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: parseInt(match[1], 10), month: parseInt(match[2], 10), day: parseInt(match[3], 10) };
}

export function formatLocalDate(dateStr: string, locale: string = 'es-MX'): string {
  const parsed = parseDate(dateStr);
  if (!parsed) return dateStr;
  const { year, month, day } = parsed;
  try {
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  } catch {
    return dateStr;
  }
}

export function formatLocalDateShort(dateStr: string, locale: string = 'es-MX'): string {
  const parsed = parseDate(dateStr);
  if (!parsed) return dateStr;
  const { year, month, day } = parsed;
  try {
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat(locale, {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return dateStr;
  }
}
