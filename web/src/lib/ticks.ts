// Y-akselin tikit. Jaettu LineChartin ja BarChartin kesken, jotta molemmat
// kuvaajat piirtävät akselinsa samalla logiikalla.

/**
 * Siistit y-akselin tikit: askel 1/2/5 × 10^k niin, että väli [min, max]
 * peittyy ~4 askeleella. Tikit ovat tarkkoja arvoja, joten viiva/palkki osuu
 * täsmälleen akselin lukemiin (ei pyöristettyjä välejä).
 */
export function niceTicks(min: number, max: number, integer: boolean): number[] {
  if (min === max) {
    min = Math.max(0, min - 1);
    max = max + 1;
  }
  const raw = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  // kynnykset 1.5/3/7: antaa 4–7 tikkiä eikä harvenna akselia turhaan
  let step = (norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10) * mag;
  if (integer && step < 1) step = 1;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const n = Math.round((end - start) / step);
  return Array.from({ length: n + 1 }, (_, i) => start + i * step);
}
