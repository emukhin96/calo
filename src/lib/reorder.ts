// Перестановка строк списка по id (приёмы дня в дневнике, свой список приёмов
// в Профиле): чистые функции без React — ./reorder.test.ts.

/**
 * Строки в порядке ids (перетащили — порядок ещё не подтвердил сервер).
 * Строк, которых нет в ids (приём появился, пока шёл запрос), — в конце, в
 * своём порядке; id без строки (приём удалили) пропускаются.
 */
export function arrangeById<T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const placed = new Set<string>();
  const out: T[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r || placed.has(id)) continue;
    placed.add(id);
    out.push(r);
  }
  return [...out, ...rows.filter((r) => !placed.has(r.id))];
}

/** Список с элементом i на месте j (остальные сдвигаются). */
export function moveTo<T>(list: readonly T[], i: number, j: number): T[] {
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(i, 1);
  next.splice(j, 0, item);
  return next;
}

/** Список с элементом id на соседнем месте (dir −1 — выше, +1 — ниже); на краю или без него — как был. */
export function moveId(ids: readonly string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  return i < 0 ? [...ids] : moveTo(ids, i, i + dir);
}
