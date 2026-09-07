'use client';

import { useEffect, useId, useRef } from 'react';

export function ConfirmDialog({ open, title, description, confirmLabel, busy = false, onConfirm, onClose }: { open: boolean; title: string; description: string; confirmLabel: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null); const titleId = useId(); const descriptionId = useId();
  useEffect(() => {
    if (!open) return; const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; cancelRef.current?.focus();
    return () => previous?.focus();
  }, [open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-text/55 p-4" onKeyDown={(event) => {
    if (event.key === 'Escape' && !busy) onClose();
    if (event.key !== 'Tab') return; const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []); if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}><div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="surface-enter max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border bg-surface-raised p-5 shadow-xl"><h2 id={titleId} className="text-xl font-bold">{title}</h2><p id={descriptionId} className="mt-2 text-sm text-text-muted">{description}</p><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button ref={cancelRef} disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border bg-surface px-4 hover:bg-surface-subtle">Cancelar</button><button disabled={busy} onClick={onConfirm} className="min-h-11 rounded-xl bg-danger px-4 font-semibold text-on-primary hover:opacity-90 disabled:opacity-50">{busy ? 'Procesando…' : confirmLabel}</button></div></div></div>;
}
