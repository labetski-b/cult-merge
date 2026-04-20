export type AnalyticsEvent =
  | {
      type: 'line_upgrade_applied';
      payload: {
        line: string;
        appliedUpgrades: number;
        mergeCountAtApply: number;
      };
    };

const listeners = new Set<(e: AnalyticsEvent) => void>();

export function trackEvent(event: AnalyticsEvent): void {
  if (import.meta.env.DEV) {
    console.log('[analytics]', event);
  }
  for (const fn of listeners) fn(event);
}

export function onAnalytics(fn: (e: AnalyticsEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function trackLineUpgradeApplied(
  line: string,
  appliedUpgrades: number,
  mergeCountAtApply: number
): void {
  trackEvent({ type: 'line_upgrade_applied', payload: { line, appliedUpgrades, mergeCountAtApply } });
}
