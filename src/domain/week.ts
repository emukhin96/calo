// Недельный разбор — docs/ARCHITECTURE.md §6. Всё детерминированно: цифры
// в тексте всегда совпадают с данными. Правила — чистые функции над WeekStats,
// у каждого есть тест (week.test.ts).
import type { Norm, Norms } from "./norms";
import { MICROS, type NutrientKey, type NutrientVector } from "./nutrients";
import { countOf, formatDecimal, formatInt, plural } from "./text";

/** Запись дневника, уже привязанная к местной дате. */
export type DayEntry = { date: string; nutrients: NutrientVector };

/** День с записями меньше этой доли нормы — «неполный»: в средние не идёт. */
export const COMPLETE_DAY_SHARE = 0.4;
/** Нутриент оцениваем, если продукты с известным значением дают ≥ 70 % калорий. */
export const MIN_COVERAGE = 0.7;
/** «Добрать», если даже с поправкой на неизвестное меньше 70 % нормы. */
export const TOP_UP_SHARE = 0.7;

export type DayStat = {
  date: string;
  count: number;
  kcal: number;
  complete: boolean;
  /** Сумма нутриента по записям, где он известен. */
  sums: Partial<Record<NutrientKey, number>>;
  /** Калории записей, у которых нутриент известен — для оценки полноты данных. */
  knownKcal: Partial<Record<NutrientKey, number>>;
};

export type WeekStats = {
  dates: string[];
  days: DayStat[];
  loggedDays: number;
  completeDays: DayStat[];
  /** Средние за полные дни по известным данным (нижняя оценка). */
  avg: Partial<Record<NutrientKey, number>>;
  /** Доля калорий полных дней, у которых нутриент известен (0…1). */
  coverage: Partial<Record<NutrientKey, number>>;
  /** Калорий в день из записей, где нутриент неизвестен (среднее по полным дням). */
  unknownKcal: Partial<Record<NutrientKey, number>>;
};

export function summarizeWeek(dates: string[], entries: DayEntry[], norms: Norms): WeekStats {
  const keys = Object.keys(norms.nutrients) as NutrientKey[];
  const days: DayStat[] = dates.map((date) => {
    const list = entries.filter((e) => e.date === date);
    const sums: DayStat["sums"] = {};
    const knownKcal: DayStat["knownKcal"] = {};
    for (const e of list) {
      const kcal = e.nutrients.kcal ?? 0;
      for (const k of keys) {
        const v = e.nutrients[k];
        if (v == null) continue;
        sums[k] = (sums[k] ?? 0) + v;
        knownKcal[k] = (knownKcal[k] ?? 0) + kcal;
      }
    }
    const kcal = sums.kcal ?? 0;
    return { date, count: list.length, kcal, complete: kcal >= COMPLETE_DAY_SHARE * norms.kcal, sums, knownKcal };
  });

  const completeDays = days.filter((d) => d.complete);
  const totalKcal = completeDays.reduce((s, d) => s + d.kcal, 0);
  const avg: WeekStats["avg"] = {};
  const coverage: WeekStats["coverage"] = {};
  const unknownKcal: WeekStats["unknownKcal"] = {};
  for (const k of keys) {
    if (completeDays.length === 0) continue;
    const known = completeDays.reduce((s, d) => s + (d.knownKcal[k] ?? 0), 0);
    avg[k] = completeDays.reduce((s, d) => s + (d.sums[k] ?? 0), 0) / completeDays.length;
    coverage[k] = totalKcal > 0 ? known / totalKcal : 0;
    unknownKcal[k] = (totalKcal - known) / completeDays.length;
  }
  return { dates, days, loggedDays: days.filter((d) => d.count > 0).length, completeDays, avg, coverage, unknownKcal };
}

// ─── Правила ────────────────────────────────────────────────────────────────

export type WeekContext = {
  week: WeekStats;
  prev: WeekStats | null;
  norms: Norms;
  goal: "lose" | "maintain" | "gain";
  /** Изменение веса за неделю, кг (последнее взвешивание недели − последнее до неё). */
  weightChangeKg: number | null;
  rateKgPerWeek: number | null;
  /**
   * Высокая правдоподобная плотность нутриента на 1 ккал (90-й процентиль по
   * справочнику, seed/foods/density.json) — для продуктов с неизвестным составом.
   */
  densities?: Partial<Record<NutrientKey, number>>;
};

export type TopUp = { nutrient: NutrientKey; text: string; share: number };

export type WeekReport = {
  weekStart: string;
  avgKcal: number | null;
  norm: number;
  loggedDays: number;
  completeDays: number;
  good: string[];
  watch: string[];
  topUp: TopUp[];
  /** Сноска внизу: «по витаминам данных мало». */
  note: string | null;
  chart: { date: string; kcal: number; complete: boolean }[];
  corridor: [number, number];
};

const DAYS: [string, string, string] = ["день", "дня", "дней"];
/** После «из»: «из 1 дня», «из 7 дней». */
const DAYS_GEN: [string, string, string] = ["дня", "дней", "дней"];
const inRange = (x: number, [lo, hi]: [number, number]) => x >= lo && x <= hi;
const pct = (x: number) => Math.round(x * 100);

/** «Дневник вели 7 дней из семи» — главная опора разбора. */
function logging({ week }: WeekContext): { good?: string; watch?: string } {
  const n = week.loggedDays;
  const incomplete = n - week.completeDays.length;
  const tail =
    incomplete > 0 ? ` (${countOf(incomplete, DAYS)} ${plural(incomplete, ["записан", "записаны", "записаны"])} не полностью)` : "";
  if (n >= 6) return { good: `Дневник вели ${countOf(n, DAYS)} из семи — разбору есть на что опереться${tail}.` };
  if (n >= 1) return { watch: `Дневник вели ${countOf(n, DAYS)} из семи — выводы приблизительные${tail}.` };
  return {};
}

function corridor({ week, norms, goal }: WeekContext): { good?: string; watch?: string } {
  const days = week.completeDays;
  if (days.length === 0) return {};
  const inside = days.filter((d) => inRange(d.kcal, norms.kcalRange)).length;
  const avg = week.avg.kcal ?? 0;
  const [lo, hi] = norms.kcalRange;
  const res: { good?: string; watch?: string } = {};
  if (inside * 2 >= days.length) {
    res.good = `${countOf(inside, DAYS)} из ${days.length} ${plural(inside, ["попал", "попали", "попали"])} в коридор нормы.`;
  }
  if (avg > hi) {
    res.watch = `В среднем ${formatInt(avg)} ккал в день — выше коридора нормы (${formatInt(lo)}–${formatInt(hi)}).`;
  } else if (avg < lo) {
    res.watch =
      goal === "lose"
        ? `В среднем ${formatInt(avg)} ккал в день — ниже коридора: слишком большой дефицит тяжело держать, и уходит мышечная масса.`
        : `В среднем ${formatInt(avg)} ккал в день — ниже коридора нормы (${formatInt(lo)}–${formatInt(hi)}).`;
  }
  return res;
}

function protein({ week, norms }: WeekContext): { good?: string; watch?: string } {
  const norm = norms.nutrients.protein?.value;
  const days = week.completeDays;
  if (!norm || days.length === 0) return {};
  const ok = days.filter((d) => (d.sums.protein ?? 0) >= 0.9 * norm).length;
  if (ok * 2 >= days.length) return { good: `Белок добран в ${ok} из ${countOf(days.length, DAYS_GEN)}.` };
  return {
    watch: `Белок добран только в ${ok} из ${countOf(days.length, DAYS_GEN)}: в среднем ${formatInt(week.avg.protein ?? 0)} г при норме ${formatInt(norm)} г.`,
  };
}

/** Сравнение с неделей раньше: к норме — хорошо, от нормы — посмотреть. */
function trend({ week, prev, norms }: WeekContext): { good?: string; watch?: string } {
  const now = week.avg.kcal;
  const before = prev?.avg.kcal;
  if (now == null || before == null || !prev || prev.completeDays.length < 3 || week.completeDays.length < 3) return {};
  const gapNow = Math.abs(now - norms.kcal);
  const gapBefore = Math.abs(before - norms.kcal);
  const change = (now - before) / before;
  if (gapBefore >= 100 && gapNow < gapBefore * 0.8) {
    return { good: `Разрыв с нормой сократился на ${pct(1 - gapNow / gapBefore)}% против недели раньше.` };
  }
  if (Math.abs(change) >= 0.05 && gapNow > gapBefore && gapNow >= 0.05 * norms.kcal) {
    return { watch: `Калорий на ${pct(Math.abs(change))}% ${change > 0 ? "больше" : "меньше"}, чем неделей раньше.` };
  }
  return {};
}

function weight({ weightChangeKg: d, goal, rateKgPerWeek }: WeekContext): { good?: string; watch?: string } {
  if (d == null) return {};
  const text = `${d > 0 ? "+" : d < 0 ? "−" : "±"}${formatDecimal(Math.abs(d))} кг`;
  const rate = rateKgPerWeek ?? 0.5;
  if (goal === "lose") {
    if (d < 0 && -d <= rate * 2) return { good: `Вес ${text} за неделю — в темпе цели.` };
    if (d < 0) return { watch: `Вес ${text} за неделю — быстрее цели ${formatDecimal(rate)} кг: часть — вода, но стоит проверить, хватает ли еды.` };
    return {};
  }
  if (goal === "gain") return d > 0 && d <= rate * 2 ? { good: `Вес ${text} за неделю — в темпе цели.` } : {};
  return Math.abs(d) <= 0.5 ? { good: `Вес стабилен: ${text} за неделю.` } : {};
}

/** Натрий: предел; по известным данным (нижняя оценка) — если уже больше, то точно больше. */
function sodium({ week, norms }: WeekContext): { watch?: string } {
  const limit = norms.nutrients.sodium;
  const avg = week.avg.sodium;
  if (!limit || avg == null || limit.kind !== "limit" || avg <= limit.value) return {};
  return {
    watch: `Натрия в среднем ${formatInt(avg)} мг в день — больше предела ${formatInt(limit.value)} мг (≈ ${formatDecimal((avg * 2.5) / 1000)} г соли): колбасы, сыры, соусы, готовая еда.`,
  };
}

/** Источники в привычной еде — без добавок, кроме витамина D (его в еде мало). */
export const SOURCES: Partial<Record<NutrientKey, string>> = {
  fiber: "овощи, бобовые, цельнозерновой хлеб, ягоды",
  vitA: "морковь, тыква, шпинат, печень",
  vitC: "болгарский перец, смородина, цитрусовые, капуста",
  vitD: "жирная рыба, яйца, добавка D3",
  vitE: "подсолнечное масло, семечки, миндаль",
  vitK: "зелень, капуста, брокколи",
  b1: "гречка, свинина, горох, семечки",
  b2: "творог, яйца, печень, грибы",
  b6: "курица, рыба, бананы, нут",
  b9: "зелень, бобовые, брокколи, печень",
  b12: "говядина, рыба, яйца, молочное",
  calcium: "творог, сыр, кефир, кунжут",
  iron: "говядина, печень, гречка, чечевица",
  magnesium: "гречка, орехи, фасоль, какао",
  potassium: "картофель, бананы, курага, фасоль",
  zinc: "говядина, тыквенные семечки, сыр, гречка",
  selenium: "рыба, яйца, морепродукты",
  omega3: "жирная рыба, льняное семя, грецкие орехи",
};

const TOP_UP_NAMES: Partial<Record<NutrientKey, string>> = {
  fiber: "Клетчатка", vitA: "Витамин A", vitC: "Витамин C", vitD: "Витамин D", vitE: "Витамин E", vitK: "Витамин K",
  b1: "Витамин B1", b2: "Витамин B2", b6: "Витамин B6", b9: "Фолаты (B9)", b12: "Витамин B12",
  calcium: "Кальций", iron: "Железо", magnesium: "Магний", potassium: "Калий", zinc: "Цинк",
  selenium: "Селен", omega3: "Омега-3",
};

/**
 * «Чем добрать»: до трёх нутриентов с наибольшим недобором. Оценка сверху:
 * известное + калории продуктов с неизвестным составом × высокая плотность
 * нутриента (как у богатых им продуктов). Если даже так меньше 70 % нормы —
 * недобор реальный. Пропорция по калориям здесь не годится: 200 г творога
 * дают мало калорий, но много кальция. При полноте < 70 % не оцениваем вовсе.
 */
function topUp({ week, norms, densities }: WeekContext): { topUp: TopUp[]; note: string | null } {
  if (week.completeDays.length === 0) return { topUp: [], note: null };
  const candidates: (NutrientKey)[] = ["fiber", ...MICROS];
  const out: TopUp[] = [];
  let unknown = 0;
  for (const k of candidates) {
    const norm: Norm | undefined = norms.nutrients[k];
    if (!norm || norm.kind !== "min" || !SOURCES[k]) continue;
    const cov = week.coverage[k] ?? 0;
    if (cov < MIN_COVERAGE) {
      unknown++;
      continue;
    }
    const known = week.avg[k] ?? 0;
    const density = densities?.[k];
    const estimate = density != null ? known + (week.unknownKcal[k] ?? 0) * density : known / cov;
    const share = estimate / norm.value;
    if (share < TOP_UP_SHARE) out.push({ nutrient: k, share, text: `${TOP_UP_NAMES[k]}: ${SOURCES[k]}` });
  }
  out.sort((a, b) => a.share - b.share);
  const note =
    unknown >= 5
      ? `По ${countOf(unknown, ["нутриенту", "нутриентам", "нутриентам"])} данных мало: у части продуктов не указан состав.`
      : null;
  return { topUp: out.slice(0, 3), note };
}

export function buildWeekReport(weekStart: string, ctx: WeekContext): WeekReport {
  const parts: { good?: string; watch?: string }[] = [logging(ctx), corridor(ctx), protein(ctx), trend(ctx), weight(ctx), sodium(ctx)];
  const { topUp: top, note } = topUp(ctx);
  return {
    weekStart,
    avgKcal: ctx.week.avg.kcal ?? null,
    norm: ctx.norms.kcal,
    loggedDays: ctx.week.loggedDays,
    completeDays: ctx.week.completeDays.length,
    good: parts.flatMap((p) => (p.good ? [p.good] : [])),
    watch: parts.flatMap((p) => (p.watch ? [p.watch] : [])),
    topUp: top,
    note,
    chart: ctx.week.days.map((d) => ({ date: d.date, kcal: Math.round(d.kcal), complete: d.complete })),
    corridor: ctx.norms.kcalRange,
  };
}
