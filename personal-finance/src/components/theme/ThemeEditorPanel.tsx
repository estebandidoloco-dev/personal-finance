'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle as CheckCircleIcon,
  RotateCcw as UndoIcon,
  RotateCw as RedoIcon,
  Shuffle as ShuffleIcon,
  X as CloseIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ColorInput } from '@/components/ui/color-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';
import type { ThemeConfig, ThemeStyle } from '@/types/theme';
import {
  BASE_COLOR_OPTIONS,
  FONT_CATEGORIES,
  FONT_OPTIONS,
  STYLE_PRESETS,
  defaultChartColors,
  useTheme,
} from '@/lib/theme/theme-provider';
import {
  ACCENT_SWATCHES,
  DENSITY_OPTIONS,
  FONT_SCALE_OPTIONS,
  MOTION_OPTIONS,
} from '@/lib/theme/theme-options';
import { parseThemeConfig, serializeThemeConfig } from '@/lib/theme/theme-config-io';
import { THEME_PRESETS } from '@/lib/theme/theme-presets';
import { ThemeSample } from '@/components/theme/ThemeSample';

const STYLE_OPTIONS = (Object.keys(STYLE_PRESETS) as ThemeStyle[]).map((value) => ({
  value,
  label: STYLE_PRESETS[value].label,
  hint: STYLE_PRESETS[value].hint,
}));

const BASE_MODE_OPTIONS = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
] as const;

const TABS = [
  { value: 'gallery', label: 'Temas' },
  { value: 'base', label: 'Base' },
  { value: 'color', label: 'Color' },
  { value: 'type', label: 'Fuentes' },
  { value: 'settings', label: 'Ajustes' },
] as const;
type TabValue = (typeof TABS)[number]['value'];

const NEUTRAL_TEXT = '[text-transform:none] [letter-spacing:normal]';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className={cn('text-xs font-semibold', NEUTRAL_TEXT)}>{label}</Label>
        {action}
      </div>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice<T extends string>({
  options,
  value,
  onChange,
  columns = options.length,
  label,
}: {
  options: readonly { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
  columns?: number;
  label: string;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      aria-label={label}
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className={cn(
            NEUTRAL_TEXT,
            'h-auto min-w-0 flex-col items-start gap-0 px-2.5 py-1.5 text-left text-xs whitespace-normal',
            !option.hint && 'items-center text-center'
          )}
        >
          <span className="font-medium break-words">{option.label}</span>
          {option.hint && (
            <span className="text-[11px] font-normal break-words opacity-70">
              {option.hint}
            </span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function PreviewChoice<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
  label,
  renderPreview,
}: {
  options: readonly { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
  columns?: number;
  label: string;
  renderPreview: (value: T) => ReactNode;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      aria-label={label}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className={cn(
            NEUTRAL_TEXT,
            'h-auto flex-col items-stretch gap-0 overflow-hidden p-0 text-xs'
          )}
        >
          <div className="relative">
            {renderPreview(option.value)}
            {value === option.value && (
              <CheckCircleIcon
                aria-hidden="true"
                className="absolute top-1 right-1 size-4 rounded-full bg-card text-primary"
              />
            )}
          </div>
          <span className="truncate px-2 py-1.5 text-left font-medium">
            {option.label}
          </span>
          {option.hint && (
            <span className="truncate px-2 pb-1.5 text-left text-[10px] font-normal opacity-70">
              {option.hint}
            </span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const HEX_DRAFT = /^#[0-9a-fA-F]{6}$/;

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className={cn('text-xs font-semibold', NEUTRAL_TEXT)}>{label}</Label>
        <div className="flex items-center gap-1.5">
          <ColorInput
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={label}
          />
          <Input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (HEX_DRAFT.test(event.target.value)) onChange(event.target.value);
            }}
            className="h-8 w-24 px-2 font-mono text-[11px]"
            aria-label={`${label} (hex)`}
            spellCheck={false}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ACCENT_SWATCHES.map((swatch) => (
          <Button
            key={swatch.hex}
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onChange(swatch.hex)}
            aria-label={swatch.name}
            title={swatch.name}
            aria-pressed={value.toLowerCase() === swatch.hex}
            className={cn(
              'size-5 rounded-full border p-0 transition-transform hover:scale-110',
              value.toLowerCase() === swatch.hex
                ? 'scale-110 border-foreground ring-2 ring-primary/40'
                : 'border-border/60'
            )}
            style={{ backgroundColor: swatch.hex }}
          />
        ))}
      </div>
    </div>
  );
}

function FontCombobox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = FONT_OPTIONS.find((font) => font.id === value);
  const normalized = query.trim().toLocaleLowerCase('es-MX');
  const filtered = normalized
    ? FONT_OPTIONS.filter((font) =>
        font.label.toLocaleLowerCase('es-MX').includes(normalized)
      )
    : FONT_OPTIONS;

  return (
    <Field label={label}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className={cn('w-full justify-between font-normal', NEUTRAL_TEXT)}
          >
            <span className="truncate" style={{ fontFamily: selected?.stack }}>
              {selected?.label ?? 'Elegir…'}
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              ⌄
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(20rem,var(--radix-popover-trigger-width))] p-0"
        >
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar tipografía…"
              aria-label="Buscar tipografía"
              className={cn('h-8', NEUTRAL_TEXT)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {FONT_CATEGORIES.map(({ value: category, label: group }) => {
              const options = filtered.filter((font) => font.category === category);
              if (options.length === 0) return null;
              return (
                <div key={category} className="py-1">
                  <p
                    className={cn(
                      'px-2 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase',
                      NEUTRAL_TEXT
                    )}
                  >
                    {group}
                  </p>
                  {options.map((font) => (
                    <Button
                      key={font.id}
                      type="button"
                      variant="row"
                      className={cn(
                        'w-full justify-start rounded-md px-2 py-1.5',
                        font.id === value && 'bg-accent'
                      )}
                      onClick={() => {
                        onChange(font.id);
                        setOpen(false);
                        setQuery('');
                      }}
                    >
                      <span style={{ fontFamily: font.stack }}>{font.label}</span>
                    </Button>
                  ))}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="p-3 text-center text-xs text-muted-foreground">
                Sin resultados.
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </Field>
  );
}


function PresetGallery({ onApply }: { onApply: (config: ThemeConfig) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Empieza de una combinación completa y sigue ajustando lo que quieras.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {THEME_PRESETS.map((item) => (
          <Button
            key={item.id}
            type="button"
            variant="outline"
            className={cn(
              'h-auto flex-col items-stretch gap-0 overflow-hidden p-0',
              NEUTRAL_TEXT
            )}
            onClick={() => {
              onApply(item.config);
              toast.success(`Tema "${item.label}" aplicado.`);
            }}
          >
            <ThemeSample config={item.config} className="h-20" />
            <span className="px-2.5 pt-1.5 text-left text-xs font-semibold">
              {item.label}
            </span>
            <span className="px-2.5 pb-1.5 text-left text-[10px] font-normal text-muted-foreground">
              {item.description}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (config: ThemeConfig) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function apply() {
    const result = parseThemeConfig(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onImport(result.config);
    setText('');
    setError(null);
    onOpenChange(false);
    toast.success('Tema importado.');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar tema</DialogTitle>
          <DialogDescription>
            Pega el JSON de un tema exportado. Reemplaza tu tema personalizado actual;
            puedes deshacerlo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            rows={10}
            spellCheck={false}
            className="font-mono text-xs"
            aria-label="JSON del tema"
            aria-invalid={error ? true : undefined}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={text.trim() === ''} onClick={apply}>
            Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ThemeEditorPanel() {
  const {
    resolvedConfig: config,
    editorOpen,
    setEditorOpen,
    updateConfig,
    resetConfig,
    shuffleConfig,
    importConfig,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useTheme();
  const [importOpen, setImportOpen] = useState(false);
  const [tab, setTab] = useState<TabValue>('gallery');

  useEffect(() => {
    if (!editorOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditorOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editorOpen, setEditorOpen]);

  if (!editorOpen) return null;

  async function exportTheme() {
    try {
      await navigator.clipboard.writeText(serializeThemeConfig(config));
      toast.success('Tema copiado al portapapeles.');
    } catch {
      toast.error('No se pudo copiar. Revisa los permisos del navegador.');
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200"
        onClick={() => setEditorOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card text-card-foreground shadow-2xl',
          'animate-in slide-in-from-bottom duration-200',
          'lg:inset-auto lg:top-0 lg:right-0 lg:bottom-0 lg:left-auto lg:max-h-none lg:w-[420px] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l lg:border-border lg:shadow-2xl lg:animate-in lg:slide-in-from-right lg:duration-200'
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Personalizar apariencia"
      >
      <div className="flex shrink-0 justify-center pt-2 lg:hidden">
        <span className="h-1 w-10 rounded-full bg-border" />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Personalizar apariencia
          </p>
          <p className="text-[11px] text-muted-foreground">
            Los cambios se aplican y guardan al instante.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditorOpen(false)}
          aria-label="Cerrar"
          className="shrink-0 text-muted-foreground"
        >
          <CloseIcon className="size-4" />
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={!canUndo}
          onClick={undo}
          className={NEUTRAL_TEXT}
        >
          <UndoIcon className="size-3" />
          Deshacer
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={!canRedo}
          onClick={redo}
          className={NEUTRAL_TEXT}
        >
          <RedoIcon className="size-3" />
          Rehacer
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={shuffleConfig}
          title="Combinar opciones al azar"
          className={cn('ml-auto', NEUTRAL_TEXT)}
        >
          <ShuffleIcon className="size-3" />
          Mezclar
        </Button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as TabValue)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 border-b border-border px-4 pt-2">
          <TabsList variant="line" className="w-full justify-start">
            {TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value} className="text-xs">
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <TabsContent value="gallery">
            <PresetGallery onApply={importConfig} />
          </TabsContent>

          <TabsContent value="base" className="space-y-6">
            <Section title="Estilo de componentes">
              <Field
                label="Lenguaje visual"
                hint="Cambia la estructura de tarjetas, campos y botones."
              >
                <PreviewChoice
                  label="Estilo de componentes"
                  columns={2}
                  options={STYLE_OPTIONS}
                  value={config.style}
                  onChange={(style) => updateConfig({ style })}
                  renderPreview={(style) => (
                    <ThemeSample config={{ ...config, style }} className="h-16" />
                  )}
                />
              </Field>
            </Section>

            <Section title="Superficies">
              <Field label="Modo base">
                <Choice
                  label="Modo base"
                  options={BASE_MODE_OPTIONS}
                  value={config.baseMode}
                  onChange={(baseMode) => updateConfig({ baseMode })}
                />
              </Field>
              <Field
                label="Familia neutral"
                hint="El tinte de las superficies y bordes neutros."
              >
                <PreviewChoice
                  label="Familia neutral"
                  columns={2}
                  options={BASE_COLOR_OPTIONS}
                  value={config.baseColor}
                  onChange={(baseColor) => updateConfig({ baseColor })}
                  renderPreview={(baseColor) => (
                    <ThemeSample config={{ ...config, baseColor }} className="h-14" />
                  )}
                />
              </Field>
            </Section>
          </TabsContent>

          <TabsContent value="color" className="space-y-6">
            <Section title="Marca">
              <ColorField
                label="Color de acento"
                value={config.accent}
                onChange={(accent) =>
                  updateConfig({
                    accent,
                    chartColors: defaultChartColors(accent),
                  })
                }
              />
            </Section>

            <Section title="Gráficas">
              <Field
                label="Paleta de 5 tonos"
                hint="Para comparativas y gráficos de categorías."
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      updateConfig({
                        chartColors: defaultChartColors(config.accent),
                      })
                    }
                    className={cn('h-6 px-1.5 text-[11px]', NEUTRAL_TEXT)}
                  >
                    Restablecer
                  </Button>
                }
              >
                <div className="grid grid-cols-5 gap-2">
                  {config.chartColors.map((color, index) => (
                    <div key={index} className="flex flex-col items-center gap-1">
                      <ColorInput
                        value={color}
                        onChange={(event) => {
                          const next = [...config.chartColors] as [
                            string,
                            string,
                            string,
                            string,
                            string,
                          ];
                          next[index] = event.target.value;
                          updateConfig({ chartColors: next });
                        }}
                        aria-label={`Color de gráfica ${index + 1}`}
                      />
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {index + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </Field>
            </Section>
          </TabsContent>

          <TabsContent value="type" className="space-y-6">
            <Section title="Tipografía">
              <FontCombobox
                label="Titulares"
                value={config.headingFont}
                onChange={(headingFont) => updateConfig({ headingFont })}
              />
              <FontCombobox
                label="Texto principal"
                value={config.bodyFont}
                onChange={(bodyFont) => updateConfig({ bodyFont })}
              />
            </Section>
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <Section title="Forma y estructura">
              <Field
                label="Esquinas y radio"
                hint="0 para bordes rectos, 1 para curvas amplias."
                action={
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {Math.round(config.radius * 16)}px
                  </span>
                }
              >
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[config.radius]}
                  onValueChange={([radius]) => updateConfig({ radius })}
                  aria-label="Radio"
                />
              </Field>
            </Section>


            <Section title="Accesibilidad y ritmo">
              <Field
                label="Tamaño del texto"
                hint="Escala todo el texto y los tamaños de la interfaz."
              >
                <Choice
                  label="Tamaño del texto"
                  options={FONT_SCALE_OPTIONS.map((option) => ({
                    value: String(option.value),
                    label: option.label,
                  }))}
                  value={String(config.fontScale)}
                  onChange={(fontScale) => updateConfig({ fontScale: Number(fontScale) })}
                  columns={2}
                />
              </Field>
              <Field label="Densidad" hint="Cuánto espacio hay entre los elementos.">
                <Choice
                  label="Densidad"
                  options={DENSITY_OPTIONS}
                  value={config.density}
                  onChange={(density) => updateConfig({ density })}
                />
              </Field>
              <Field
                label="Animaciones"
                hint="Reducidas apaga transiciones y movimiento."
              >
                <Choice
                  label="Animaciones"
                  options={MOTION_OPTIONS}
                  value={config.motion}
                  onChange={(motion) => updateConfig({ motion })}
                />
              </Field>
            </Section>
          </TabsContent>
        </div>
      </Tabs>

      <div
        className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-4 py-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('flex-1', NEUTRAL_TEXT)}
          onClick={exportTheme}
        >
          Exportar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('flex-1', NEUTRAL_TEXT)}
          onClick={() => setImportOpen(true)}
        >
          Importar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('w-full', NEUTRAL_TEXT)}
          onClick={resetConfig}
        >
          Restablecer a valores por defecto
        </Button>
      </div>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={importConfig}
      />
    </aside>
  </>
  );
}
