import type { ReactNode } from 'react';
import {
  Baby,
  Briefcase,
  Building2,
  Bus,
  Car,
  CircleEllipsis,
  Coffee,
  CreditCard,
  Dog,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Music,
  PiggyBank,
  Plane,
  Shirt,
  ShoppingBag,
  Smartphone,
  Tags,
  Utensils,
  Wifi,
  Wrench,
} from 'lucide-react';
import { resolveCategoryIconKey, type CategoryIconKey } from '@/lib/ui/category-icon';

const icons: Record<CategoryIconKey, ReactNode> = {
  home: <House aria-hidden="true" className="size-5" />,
  utensils: <Utensils aria-hidden="true" className="size-5" />,
  car: <Car aria-hidden="true" className="size-5" />,
  'heart-pulse': <HeartPulse aria-hidden="true" className="size-5" />,
  'gamepad-2': <Gamepad2 aria-hidden="true" className="size-5" />,
  'shopping-bag': <ShoppingBag aria-hidden="true" className="size-5" />,
  'credit-card': <CreditCard aria-hidden="true" className="size-5" />,
  plane: <Plane aria-hidden="true" className="size-5" />,
  'graduation-cap': <GraduationCap aria-hidden="true" className="size-5" />,
  dog: <Dog aria-hidden="true" className="size-5" />,
  music: <Music aria-hidden="true" className="size-5" />,
  dumbbell: <Dumbbell aria-hidden="true" className="size-5" />,
  briefcase: <Briefcase aria-hidden="true" className="size-5" />,
  gift: <Gift aria-hidden="true" className="size-5" />,
  coffee: <Coffee aria-hidden="true" className="size-5" />,
  wrench: <Wrench aria-hidden="true" className="size-5" />,
  'building-2': <Building2 aria-hidden="true" className="size-5" />,
  bus: <Bus aria-hidden="true" className="size-5" />,
  baby: <Baby aria-hidden="true" className="size-5" />,
  shirt: <Shirt aria-hidden="true" className="size-5" />,
  smartphone: <Smartphone aria-hidden="true" className="size-5" />,
  wifi: <Wifi aria-hidden="true" className="size-5" />,
  fuel: <Fuel aria-hidden="true" className="size-5" />,
  'piggy-bank': <PiggyBank aria-hidden="true" className="size-5" />,
  tags: <Tags aria-hidden="true" className="size-5" />,
  'circle-ellipsis': <CircleEllipsis aria-hidden="true" className="size-5" />,
};

export function resolveCategoryIcon(value: string | null | undefined): ReactNode {
  return icons[resolveCategoryIconKey(value)];
}

export function CategoryIcon({
  value,
  color,
}: {
  value: string | null | undefined;
  color?: string | null;
}) {
  return (
    <span
      className="bg-surface-subtle text-text-muted grid size-10 shrink-0 place-items-center rounded-xl"
      style={color ? { color } : undefined}
    >
      {resolveCategoryIcon(value)}
    </span>
  );
}
