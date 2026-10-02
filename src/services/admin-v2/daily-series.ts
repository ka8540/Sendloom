export type DailyCount = { day: Date; count: number };

export function buildUtcSeries<T extends string>(
  days: number,
  sources: Record<T, DailyCount[]>,
  now = new Date(),
): Array<{ day: string } & Record<T, number>> {
  const indexed = Object.fromEntries(
    Object.entries(sources).map(([key, rows]) => [
      key,
      new Map(
        (rows as DailyCount[]).map((row) => [
          row.day.toISOString().slice(0, 10),
          row.count,
        ]),
      ),
    ]),
  ) as Record<T, Map<string, number>>;
  return Array.from({ length: days }, (_, offset) => {
    const day = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - days + offset + 1,
      ),
    )
      .toISOString()
      .slice(0, 10);
    return {
      day,
      ...Object.fromEntries(
        Object.keys(sources).map((key) => [
          key,
          indexed[key as T].get(day) ?? 0,
        ]),
      ),
    } as { day: string } & Record<T, number>;
  });
}
