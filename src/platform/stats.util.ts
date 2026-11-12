/**
 * Bornes de périodes en UTC. Le Burkina Faso est en UTC+0 : les jours UTC
 * correspondent aux jours locaux de la boutique.
 */
export function startOfDayUtc(date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function startOfMonthUtc(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function startOfYearUtc(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

export function daysAgoUtc(days: number): Date {
  const start = startOfDayUtc();
  start.setUTCDate(start.getUTCDate() - days);
  return start;
}

export interface DayPoint {
  date: string; // YYYY-MM-DD
  nombre: number;
  chiffreAffaires: number;
}

/** Complète les jours sans vente avec des zéros, pour une courbe continue. */
export function fillDays(
  rows: Array<{ date: string; nombre: number; ca: number }>,
  days: number,
): DayPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: DayPoint[] = [];
  const start = daysAgoUtc(days - 1);
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const row = byDate.get(key);
    out.push({
      date: key,
      nombre: row?.nombre ?? 0,
      chiffreAffaires: row?.ca ?? 0,
    });
  }
  return out;
}
