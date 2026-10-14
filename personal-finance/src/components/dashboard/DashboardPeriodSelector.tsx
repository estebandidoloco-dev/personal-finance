'use client';

import { NativeSelect } from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';

interface DashboardPeriodSelectorProps {
  value: string;
  onChange: (period: string) => void;
  disabled?: boolean;
}

export function DashboardPeriodSelector({
  value,
  onChange,
  disabled = false,
}: DashboardPeriodSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="period-select" className="shrink-0 text-sm font-medium text-muted-foreground">
        Período:
      </Label>
      <NativeSelect
        id="period-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-auto"
        aria-label="Seleccionar período"
      >
        <option value="this_month">Este mes</option>
        <option value="previous_month">Mes anterior</option>
        <option value="last_30_days">Últimos 30 días</option>
      </NativeSelect>
    </div>
  );
}
