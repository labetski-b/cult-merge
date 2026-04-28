export function formatCompact(n: number): string {
  if (!isFinite(n)) return String(n);
  if (n < 0) return '-' + formatCompact(-n);
  if (n < 1000) {
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  const units: [number, string][] = [
    [1e12, 't'],
    [1e9, 'b'],
    [1e6, 'm'],
    [1e3, 'k'],
  ];
  for (const [div, suf] of units) {
    if (n >= div) {
      const v = n / div;
      let s: string;
      if (v >= 100) s = Math.floor(v).toString();
      else if (v >= 10) s = (Math.floor(v * 10) / 10).toString();
      else s = (Math.floor(v * 100) / 100).toString();
      return s + suf;
    }
  }
  return String(Math.floor(n));
}
