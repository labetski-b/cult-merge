import { useEffect, useState } from 'react';

/**
 * Forces the owning component to re-render every second while `active` is true.
 * Useful for countdown timers that read from `Date.now()` or similar
 * time-dependent state that lives outside the React store.
 *
 * Passing `active=true` unconditionally is fine — a single 1s interval is cheap
 * and does not allocate per-tick.
 */
export function useSecondTicker(active: boolean = true): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const h = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(h);
  }, [active]);
}
