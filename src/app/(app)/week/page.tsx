import { requireSession } from "@/lib/session";
import { BigNumber, ButtonLink, Eyebrow, MarkList, SectionTitle, Sheet } from "@/ui/components";
import { formatInt, plural } from "@/ui/format";
import { demoWeek } from "../demo-data";

/** Недельный разбор — эталон со скриншота. Данные пока демонстрационные (этап 5). */
export default async function WeekPage() {
  await requireSession();
  const w = demoWeek;

  return (
    <Sheet footer={<ButtonLink href="/">Понятно</ButtonLink>}>
      <Eyebrow>Неделя позади</Eyebrow>
      <div className="mt-3">
        <BigNumber value={w.avgKcal} caption={<>ккал в день · норма {formatInt(w.norm)}</>} />
      </div>
      <Eyebrow className="mt-4">
        {w.daysLogged} из 7 {plural(7, ["дня", "дней", "дней"])}
      </Eyebrow>

      <SectionTitle>Что получилось</SectionTitle>
      <MarkList kind="ok" items={w.good} />

      <SectionTitle>На что посмотреть</SectionTitle>
      <MarkList kind="warn" items={w.watch} />

      <SectionTitle>Чем добрать на этой неделе</SectionTitle>
      <MarkList kind="leaf" items={w.topUp} />
    </Sheet>
  );
}
