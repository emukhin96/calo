import { redirect } from "next/navigation";
import { todayIn } from "@/domain/day";
import { loadDay } from "@/lib/diary";
import { diaryDateOf } from "@/lib/diary-date";
import { loadUser } from "@/lib/norms";
import { shouldShowWeek } from "@/lib/week";
import { loadWeekKcal } from "@/lib/week-strip";
import { requireSession } from "@/lib/session";
import { userTimeZone } from "@/lib/tz";
import { DayView } from "./DayView";

/**
 * Дневник за день — «Лента»: /?d=2026-09-29 (по умолчанию — сегодня в часовом
 * поясе пользователя; будущие дни не открываются — дата позже сегодня
 * превращается в сегодня). Сам экран — DayView; порядок приёмов и показ их
 * времени — настройки Профиля.
 */
export default async function DayPage({ searchParams }: PageProps<"/">) {
  const session = await requireSession();
  const { norms, mealPlan, showMealTimes } = await loadUser(session.user.id);
  if (!norms) redirect("/onboarding");
  const tz = await userTimeZone(session.user.id);
  const sp = await searchParams;
  const today = todayIn(tz);
  // Первый вход после окончания недели — сначала разбор (как лист со скриншота).
  // Открывшийся разбор сразу отмечается просмотренным (week/page.tsx), так что
  // вкладка «Дневник» (/) из него сюда уже не возвращает.
  if (sp.d == null && (await shouldShowWeek(session.user.id, tz))) redirect("/week");
  const date = diaryDateOf(sp.d, today);
  const [day, weekKcal] = await Promise.all([loadDay(session.user.id, date, tz), loadWeekKcal(session.user.id, date)]);

  return (
    <DayView
      tz={tz}
      date={date}
      today={today}
      norms={norms}
      totals={day.totals}
      meals={day.meals}
      plan={mealPlan}
      showTimes={showMealTimes}
      weekKcal={weekKcal}
    />
  );
}
