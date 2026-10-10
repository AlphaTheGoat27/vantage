"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Live result of a CSS media query. `serverValue` is used for the server render and hydration. */
export function useMediaQuery(query: string, serverValue = true) {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
