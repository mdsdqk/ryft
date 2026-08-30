/**
 * A minimal history-API router — enough for ryft's six-route table and no more.
 *
 * No dependency: the route set is small and every pattern is either static or a
 * single `:param` segment, so a full router would be more surface than the app
 * needs. `RouterProvider` holds the current location, `useRouter` exposes it plus
 * `navigate`, `Link` is an <a> that pushes instead of reloading, and `matchPath`
 * does one-segment `:param` matching.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

type NavigateOptions = { replace?: boolean };

type RouterValue = {
  /** pathname only, always leading-slash, never trailing-slash (except "/") */
  path: string;
  /** the raw `?...` search string, including the leading "?" when non-empty */
  search: string;
  navigate: (to: string, opts?: NavigateOptions) => void;
};

const RouterContext = createContext<RouterValue | null>(null);

function currentPath(): string {
  const p = window.location.pathname || "/";
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => ({
    path: currentPath(),
    search: window.location.search,
  }));

  useEffect(() => {
    const sync = () =>
      setLoc({ path: currentPath(), search: window.location.search });
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const navigate = useCallback((to: string, opts?: NavigateOptions) => {
    let url: URL;
    try {
      url = new URL(to, window.location.origin);
    } catch {
      return; // a caller passed a string that is not a URL — ignore it
    }
    // stay same-origin; an absolute off-site URL falls through to a full load
    if (url.origin !== window.location.origin) {
      window.location.assign(url.href);
      return;
    }
    if (
      url.pathname === window.location.pathname &&
      url.search === window.location.search
    ) {
      return;
    }
    window.history[opts?.replace ? "replaceState" : "pushState"](null, "", url);
    setLoc({ path: currentPath(), search: url.search });
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ ...loc, navigate }),
    [loc, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const v = useContext(RouterContext);
  if (!v) throw new Error("useRouter must be used inside <RouterProvider>");
  return v;
}

/** `?key=value` reader for the current location. */
export function useQueryParam(key: string): string | null {
  const { search } = useRouter();
  return useMemo(() => new URLSearchParams(search).get(key), [search, key]);
}

/**
 * Match `pattern` against `path`. Segments starting with ":" capture; every other
 * segment must be equal. Returns the captured params, or null when it does not
 * match. `"*"` as the whole pattern matches anything (the catch-all route).
 */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // a malformed %-escape (e.g. "/branch/%E0%A4") must not crash the render
    return segment;
  }
}

export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  if (pattern === "*") return {};
  const pp = pattern.split("/").filter(Boolean);
  const ap = path.split("/").filter(Boolean);
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i]!;
    if (seg.startsWith(":")) {
      const value = safeDecode(ap[i]!);
      if (!value) return null; // an empty capture is not a match
      params[seg.slice(1)] = value;
    } else if (seg !== ap[i]) {
      return null;
    }
  }
  return params;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  /** mark the anchor `aria-current="page"` when the path matches exactly */
  currentWhenExact?: boolean;
  replace?: boolean;
};

export function Link({
  to,
  currentWhenExact = true,
  replace,
  onClick,
  children,
  "aria-current": ariaCurrentProp,
  ...rest
}: LinkProps) {
  const { path, navigate } = useRouter();

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      (rest.target && rest.target !== "_self")
    ) {
      return;
    }
    e.preventDefault();
    navigate(to, { replace });
  };

  // a caller may force the current state (the rail's Database link is "current"
  // on both "/" and "/db"); otherwise fall back to an exact path match
  const isCurrent =
    ariaCurrentProp !== undefined
      ? ariaCurrentProp
      : currentWhenExact && path === to.replace(/\?.*$/, "")
        ? "page"
        : undefined;

  return (
    <a
      href={to}
      onClick={handleClick}
      aria-current={isCurrent || undefined}
      {...rest}
    >
      {children}
    </a>
  );
}
