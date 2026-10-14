import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="border-dashed p-8 text-center">
      <h2 className="heading font-semibold">{title}</h2>
      {description && <p className="mx-auto mt-2 max-w-xl text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}
