import { useEffect, useState } from 'react';

/** Load async data and reload whenever a dependency changes. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: Error | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (error: Error) => !cancelled && setState({ data: null, error, loading: false }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
