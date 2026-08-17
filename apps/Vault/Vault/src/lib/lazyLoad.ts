import { lazy, type ComponentType } from "react";

// A redeploy purges old hashed chunks; a client holding a stale index.html
// then 404s on dynamic import. One forced reload fetches the fresh index.
// The sessionStorage guard prevents a reload loop when loading is genuinely broken.
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory().catch((err) => {
      const key = "vault.chunk-reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
      }
      throw err;
    })
  );
}
