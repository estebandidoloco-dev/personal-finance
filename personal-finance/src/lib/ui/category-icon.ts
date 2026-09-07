export const CATEGORY_ICON_OPTIONS = [
  { key: 'home', label: 'Hogar' },
  { key: 'utensils', label: 'Comida' },
  { key: 'car', label: 'Transporte' },
  { key: 'heart-pulse', label: 'Salud' },
  { key: 'gamepad-2', label: 'Juegos' },
  { key: 'shopping-bag', label: 'Compras' },
  { key: 'credit-card', label: 'Pagos' },
  { key: 'plane', label: 'Viajes' },
  { key: 'graduation-cap', label: 'Educación' },
  { key: 'dog', label: 'Mascotas' },
  { key: 'music', label: 'Música' },
  { key: 'dumbbell', label: 'Ejercicio' },
  { key: 'briefcase', label: 'Trabajo' },
  { key: 'gift', label: 'Regalos' },
  { key: 'coffee', label: 'Café' },
  { key: 'wrench', label: 'Reparaciones' },
  { key: 'building-2', label: 'Vivienda' },
  { key: 'bus', label: 'Transporte público' },
  { key: 'baby', label: 'Familia' },
  { key: 'shirt', label: 'Ropa' },
  { key: 'smartphone', label: 'Teléfono' },
  { key: 'wifi', label: 'Internet' },
  { key: 'fuel', label: 'Combustible' },
  { key: 'piggy-bank', label: 'Ahorro' },
  { key: 'tags', label: 'General' },
  { key: 'circle-ellipsis', label: 'Otro' },
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_OPTIONS)[number]['key'];

const approvedIcons = new Set<CategoryIconKey>(CATEGORY_ICON_OPTIONS.map(({ key }) => key));

export function resolveCategoryIconKey(value: string | null | undefined): CategoryIconKey {
  const normalized = value?.trim().toLowerCase() as CategoryIconKey | undefined;
  return normalized && approvedIcons.has(normalized) ? normalized : 'circle-ellipsis';
}
