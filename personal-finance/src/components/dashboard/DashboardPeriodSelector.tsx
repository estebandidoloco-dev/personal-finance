'use client';

interface DashboardPeriodSelectorProps {
  value: string;
  onChange: (period: string) => void;
  disabled?: boolean;
}

export function DashboardPeriodSelector({ value, onChange, disabled = false }: DashboardPeriodSelectorProps) {
  return (
    <div className="flex gap-2">
      <label htmlFor="period-select" className="flex items-center text-sm font-medium">
        Período:
      </label>
      <select
        id="period-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-xl border bg-surface px-3 py-2 text-sm text-text disabled:opacity-50"
        aria-label="Seleccionar período"
      >
        <option value="this_month">Este mes</option>
        <option value="previous_month">Mes anterior</option>
        <option value="last_30_days">Últimos 30 días</option>
      </select>
    </div>
  );
}
