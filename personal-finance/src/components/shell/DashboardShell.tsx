import Link from 'next/link';
import { MainNavigation } from './MainNavigation';
import { UserIdentity } from './UserIdentity';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background min-h-screen w-full min-w-0 pb-24 lg:pb-0">
      <header className="bg-surface border-b">
        <div className="mx-auto flex max-w-7xl min-w-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="min-w-0 truncate text-lg font-bold tracking-tight">
            Personal Finance
          </Link>
          <UserIdentity />
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-7xl min-w-0 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-7 lg:py-8">
        <aside className="min-w-0">
          <MainNavigation />
        </aside>
        <div className="w-full min-w-0 [&>main]:w-full [&>main]:min-w-0">{children}</div>
      </div>
    </div>
  );
}
