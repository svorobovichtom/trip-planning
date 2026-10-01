// Code-split parts of the app (tabs, heavy sheets). Each part can be
// preloaded ahead of use (after the first idle), so it renders without a
// visible fallback; the service worker precaches every chunk for offline.
import { Component, type ComponentType, lazy, type ReactNode, Suspense } from "react";

type Part<P> = ComponentType<P> & { preload: () => Promise<unknown> };

/** React.lazy over a named export, with a shared `preload()`. */
export function lazyPart<M, P extends object>(load: () => Promise<M>, pick: (m: M) => ComponentType<P>): Part<P> {
  let p: Promise<M> | null = null;
  const preload = () =>
    (p ??= load().catch((e: unknown) => {
      p = null; // let a later attempt retry (e.g. back online)
      throw e;
    }));
  const C = lazy(() => preload().then((m) => ({ default: pick(m) })));
  return Object.assign(C, { preload }) as unknown as Part<P>;
}

/** Runs `fn` once the browser is idle after the first paint (Safari has no requestIdleCallback). */
export function whenIdle(fn: () => void, timeout = 2000): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn, { timeout });
    return () => cancelIdleCallback(id);
  }
  const t = setTimeout(fn, 400);
  return () => clearTimeout(t);
}

const RELOADED = "trip.chunkReload";

/**
 * Suspense + error boundary for a lazy part. A chunk that fails to load
 * (usually: a deploy replaced the hashed files under an old page) reloads
 * the page while online, at most once a minute; otherwise a short note with a retry button.
 */
export class PartBoundary extends Component<{ children: ReactNode; fallback?: ReactNode; quiet?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    try {
      const last = Number(sessionStorage.getItem(RELOADED)) || 0;
      if (navigator.onLine && Date.now() - last > 60_000) {
        sessionStorage.setItem(RELOADED, String(Date.now()));
        location.reload();
      }
    } catch {
      /* storage blocked: show the note */
    }
  }
  render() {
    if (this.state.failed) {
      return this.props.quiet ? null : (
        <p className="note">
          Не загрузилось.{" "}
          <button className="link" type="button" onClick={() => location.reload()}>
            Обновить
          </button>
        </p>
      );
    }
    return <Suspense fallback={this.props.fallback ?? null}>{this.props.children}</Suspense>;
  }
}
