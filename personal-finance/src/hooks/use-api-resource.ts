'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ApiResourceState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'error'; data: null; error: string }
  | { status: 'empty'; data: T; error: null }
  | { status: 'success'; data: T; error: null };

export function useApiResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  dependencyKey: string,
  isEmpty: (value: T) => boolean = () => false,
) {
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<ApiResourceState<T>>({ status: 'loading', data: null, error: null });
  const sequence = useRef(0);

  useEffect(() => {
    const request = ++sequence.current;
    const controller = new AbortController();
    // Loading belongs to this new request identity; stale completions are guarded below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: 'loading', data: null, error: null });
    void loader(controller.signal).then((data) => {
      if (request !== sequence.current || controller.signal.aborted) return;
      setState(isEmpty(data)
        ? { status: 'empty', data, error: null }
        : { status: 'success', data, error: null });
    }).catch((error: unknown) => {
      if (request !== sequence.current || controller.signal.aborted) return;
      setState({
        status: 'error', data: null,
        error: error instanceof Error ? error.message : 'No se pudo completar la solicitud.',
      });
    });
    return () => {
      controller.abort();
      if (request === sequence.current) sequence.current += 1;
    };
    // Callers define request identity explicitly through dependencyKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependencyKey, retryNonce]);

  const retry = useCallback(() => setRetryNonce((value) => value + 1), []);
  return { ...state, retry };
}
