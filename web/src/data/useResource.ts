/**
 * Load one resource from the data seam, with loading / error / reload. The
 * shared shape behind every list surface so none of them hand-rolls the same
 * useEffect.
 *
 *   const { data, loading, error, reload } = useResource(() => source.getOverview());
 *
 * `loader` is called on mount and whenever `deps` change (pass `[id]` for a
 * parameterised loader) or `reload()` is invoked. The loader itself is not a
 * dependency — an inline arrow is fine.
 */

import { useCallback, useEffect, useState } from "react";

export type Resource<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
};

export function useResource<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
): Resource<T> {
  const [state, setState] = useState<Omit<Resource<T>, "reload">>({
    data: null,
    error: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const fail = (e: unknown) => {
      if (!live) return;
      const error =
        e instanceof Error
          ? e
          : new Error(typeof e === "string" ? e : "The request failed.");
      setState({ data: null, error, loading: false });
    };
    // Promise.resolve wraps a loader that throws synchronously or returns a
    // non-thenable — either would otherwise leave `loading` stuck true forever.
    Promise.resolve()
      .then(loader)
      .then((data) => {
        if (live) setState({ data, error: null, loading: false });
      }, fail);
    return () => {
      live = false;
    };
    // loader identity changes every render by design; nonce + deps drive re-runs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { ...state, reload };
}
