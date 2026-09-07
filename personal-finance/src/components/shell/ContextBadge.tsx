import { UsersRound, Wallet } from 'lucide-react';

export function ContextBadge({ household = false }: { household?: boolean }) {
  const Icon = household ? UsersRound : Wallet;
  return (
    <span
      className={`hidden min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold lg:inline-flex ${household ? 'bg-info-soft text-info' : 'bg-primary-soft text-primary'}`}
    >
      <Icon aria-hidden="true" className="size-4" />
      {household ? 'En pareja' : 'Personal'}
    </span>
  );
}
