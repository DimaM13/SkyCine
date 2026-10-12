/** Русская плюрализация с учётом 11–14: plural(1,'фильм','фильма','фильмов') → 'фильм'. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m = Math.abs(Math.round(n || 0)) % 100;
  const d = m % 10;
  if (m > 10 && m < 20) return many;
  if (d > 1 && d < 5) return few;
  if (d === 1) return one;
  return many;
}
