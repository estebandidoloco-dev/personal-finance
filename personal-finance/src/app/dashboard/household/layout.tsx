import { HouseholdProvider } from '@/components/household/HouseholdContext';

export default function HouseholdLayout({ children }: { children: React.ReactNode }) { return <HouseholdProvider>{children}</HouseholdProvider>; }
