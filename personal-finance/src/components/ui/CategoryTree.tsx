'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal, X } from 'lucide-react';
import type { CategoryNode } from '@/lib/categories';
import { CategoryIcon } from './CategoryIcon';

interface CategoryTreeProps {
  nodes: CategoryNode[];
  onEdit: (category: CategoryNode) => void;
  onDelete: (category: CategoryNode) => void;
  deletingId?: string | null;
  readOnly?: boolean;
}

type FlatRow = { category: CategoryNode; depth: number };

function descendants(category: CategoryNode): number {
  return category.children.reduce((total, child) => total + 1 + descendants(child), 0);
}

function flattenVisible(nodes: CategoryNode[], expanded: Set<string>, depth = 0): FlatRow[] {
  return nodes.flatMap((category) => [
    { category, depth },
    ...(category.children.length && expanded.has(category.id)
      ? flattenVisible(category.children, expanded, depth + 1)
      : []),
  ]);
}

function metadata(category: CategoryNode) {
  const type =
    category.type === 'expense'
      ? 'Gasto'
      : category.type === 'income'
        ? 'Ingreso'
        : category.type === 'transfer'
          ? 'Transferencia'
          : 'Ahorro';
  const budget =
    category.budget_type === 'need'
      ? 'Necesidad'
      : category.budget_type === 'want'
        ? 'Deseo'
        : category.budget_type === 'savings'
          ? 'Ahorro'
          : null;
  return [type, budget].filter(Boolean).join(' · ');
}

export function CategoryTree({
  nodes,
  onEdit,
  onDelete,
  deletingId = null,
  readOnly = false,
}: CategoryTreeProps) {
  const [expanded, setExpanded] = useState(() => new Set(nodes.map((node) => node.id)));
  const [menuId, setMenuId] = useState<string | null>(null);
  const sheetCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuId || !window.matchMedia('(max-width: 639px)').matches) return;
    sheetCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuId]);
  return (
    <ul className="min-w-0 space-y-3">
      {nodes.map((root) => (
        <li key={root.id} className="bg-surface w-full min-w-0 overflow-visible rounded-2xl border">
          {flattenVisible([root], expanded).map(({ category, depth }, index) => {
            const childCount = descendants(category);
            const hasChildren = category.children.length > 0;
            return (
              <div
                key={category.id}
                className={`relative flex min-w-0 items-center gap-3 p-4 ${index ? 'border-t' : ''} ${depth ? 'bg-surface-subtle' : ''}`}
                style={{ paddingInlineStart: `${16 + Math.min(depth, 1) * 20}px` }}
              >
                <CategoryIcon value={category.icon} color={category.color} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-words">{category.name}</p>
                  <p className="text-text-muted mt-0.5 text-sm">{metadata(category)}</p>
                </div>
                {childCount > 0 && (
                  <span className="text-text-muted hidden shrink-0 text-xs sm:block">
                    {childCount} {childCount === 1 ? 'categoría' : 'categorías'}
                  </span>
                )}
                {hasChildren && (
                  <button
                    type="button"
                    aria-label={`${expanded.has(category.id) ? 'Contraer' : 'Expandir'} ${category.name}`}
                    aria-expanded={expanded.has(category.id)}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(category.id)) next.delete(category.id);
                        else next.add(category.id);
                        return next;
                      })
                    }
                    className="hover:bg-surface-subtle grid size-11 shrink-0 place-items-center rounded-xl"
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-5 transition-transform ${expanded.has(category.id) ? '' : '-rotate-90'}`}
                    />
                  </button>
                )}
                {!readOnly && (
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      aria-label={`Acciones para ${category.name}`}
                      aria-expanded={menuId === category.id}
                      onClick={() =>
                        setMenuId((value) => (value === category.id ? null : category.id))
                      }
                      className="hover:bg-surface-subtle grid size-11 place-items-center rounded-xl"
                    >
                      <MoreHorizontal aria-hidden="true" className="size-5" />
                    </button>
                    {menuId === category.id && (
                      <div className="surface-enter bg-surface-raised absolute top-12 right-0 z-20 hidden min-w-40 rounded-xl border p-1 shadow-lg sm:block">
                        <button
                          type="button"
                          onClick={() => {
                            setMenuId(null);
                            onEdit(category);
                          }}
                          className="hover:bg-surface-subtle min-h-11 w-full rounded-lg px-3 text-left text-sm"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === category.id}
                          onClick={() => {
                            setMenuId(null);
                            onDelete(category);
                          }}
                          className="text-danger hover:bg-danger-soft min-h-11 w-full rounded-lg px-3 text-left text-sm disabled:opacity-50"
                        >
                          {deletingId === category.id ? 'Eliminando…' : 'Eliminar categoría'}
                        </button>
                      </div>
                    )}
                    {menuId === category.id && (
                      <div
                        className="bg-text/55 fixed inset-0 z-50 sm:hidden"
                        role="presentation"
                        onMouseDown={(event) => {
                          if (event.target === event.currentTarget) setMenuId(null);
                        }}
                      >
                        <section
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby={`category-actions-${category.id}`}
                          className="surface-enter bg-surface-raised absolute inset-x-0 bottom-0 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-3xl border-t p-4 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-xl"
                        >
                          <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
                            <h2
                              id={`category-actions-${category.id}`}
                              className="min-w-0 text-lg font-bold break-words"
                            >
                              {category.name}
                            </h2>
                            <button
                              ref={sheetCloseRef}
                              type="button"
                              aria-label="Cerrar acciones de categoría"
                              onClick={() => setMenuId(null)}
                              className="grid size-11 shrink-0 place-items-center rounded-xl border"
                            >
                              <X aria-hidden="true" className="size-5" />
                            </button>
                          </div>
                          <div className="space-y-2">
                            <button
                              type="button"
                              onClick={() => {
                                setMenuId(null);
                                onEdit(category);
                              }}
                              className="bg-surface hover:bg-surface-subtle min-h-12 w-full rounded-xl border px-4 text-left font-medium"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === category.id}
                              onClick={() => {
                                setMenuId(null);
                                onDelete(category);
                              }}
                              className="border-danger bg-danger-soft text-danger min-h-12 w-full rounded-xl border px-4 text-left font-medium disabled:opacity-50"
                            >
                              Eliminar categoría
                            </button>
                            <button
                              type="button"
                              onClick={() => setMenuId(null)}
                              className="bg-surface min-h-12 w-full rounded-xl border px-4 font-medium"
                            >
                              Cancelar
                            </button>
                          </div>
                        </section>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </li>
      ))}
    </ul>
  );
}
