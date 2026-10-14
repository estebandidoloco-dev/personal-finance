import { UsersIcon as UsersRound, WalletIcon as Wallet } from '@/components/ui/icons';
import { Badge } from '@/components/ui/badge';

export function ContextBadge({ household = false }: { household?: boolean }) {
  const Icon = household ? UsersRound : Wallet;
  return (
    <Badge
      variant="outline"
      className={
        household
          ? 'hidden min-h-7 items-center gap-1.5 border-info/30 bg-info-soft text-info px-2.5 text-xs font-semibold lg:inline-flex'
          : 'hidden min-h-7 items-center gap-1.5 border-primary/30 bg-primary-soft text-primary px-2.5 text-xs font-semibold lg:inline-flex'
      }
    >
      <Icon aria-hidden="true" className="size-4" />
      {household ? 'En pareja' : 'Personal'}
    </Badge>
  );
}
