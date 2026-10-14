// Undo/redo for the theme editor, as pure functions so the rules are testable
// without React. The editor changes the theme continuously while a slider or a
// colour picker is dragged, so changes that arrive in a quick burst count as ONE
// step: undo jumps back to before the drag, not to the previous pixel.

export interface ThemeHistory<T> {
  /** Older states, oldest first; the last one is what Undo restores. */
  past: T[];
  /** States undone, most recently undone last; what Redo restores. */
  future: T[];
  /** When the last change was recorded (ms), for grouping bursts. */
  lastChangeAt: number;
}

/** How many steps are kept. */
export const HISTORY_LIMIT = 30;
/** Changes closer together than this are one step. */
export const HISTORY_BURST_MS = 800;

export function emptyHistory<T>(): ThemeHistory<T> {
  return { past: [], future: [], lastChangeAt: 0 };
}

/**
 * Record that the theme is about to change away from `previous`. Starts a new
 * step unless it continues a burst; a new change always clears Redo.
 */
export function recordChange<T>(
  history: ThemeHistory<T>,
  previous: T,
  now: number,
): ThemeHistory<T> {
  const continuesBurst =
    history.past.length > 0 && now - history.lastChangeAt < HISTORY_BURST_MS;
  const past = continuesBurst
    ? history.past
    : [...history.past, previous].slice(-HISTORY_LIMIT);
  return { past, future: [], lastChangeAt: now };
}

export function canUndo<T>(history: ThemeHistory<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: ThemeHistory<T>): boolean {
  return history.future.length > 0;
}

/** Step back. `current` is what is on screen now; it becomes Redo's target. */
export function undoStep<T>(
  history: ThemeHistory<T>,
  current: T,
): { history: ThemeHistory<T>; value: T } | null {
  if (!canUndo(history)) return null;
  const past = history.past.slice(0, -1);
  const value = history.past[history.past.length - 1];
  return {
    value,
    history: {
      past,
      future: [...history.future, current],
      // Any change after an undo must start a fresh step.
      lastChangeAt: 0,
    },
  };
}

/** Step forward again. */
export function redoStep<T>(
  history: ThemeHistory<T>,
  current: T,
): { history: ThemeHistory<T>; value: T } | null {
  if (!canRedo(history)) return null;
  const future = history.future.slice(0, -1);
  const value = history.future[history.future.length - 1];
  return {
    value,
    history: {
      past: [...history.past, current].slice(-HISTORY_LIMIT),
      future,
      lastChangeAt: 0,
    },
  };
}
