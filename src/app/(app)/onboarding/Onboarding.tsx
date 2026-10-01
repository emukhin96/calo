"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ACTIVITY_RU,
  type Activity,
  computeNorms,
  GOAL_RU,
  type GoalKind,
  type Sex,
} from "@/domain/norms";
import { signOutAndClear } from "@/lib/sign-out";
import { BottomBar, Button, Eyebrow } from "@/ui/components";
import { NumberField, OptionCard, parseNum, Segmented } from "@/ui/form";
import { formatInt } from "@/ui/format";
import { AGE_YEARS, HEIGHT_CM, outOfRange, WEIGHT_KG } from "./ranges";

const RATES = [
  { value: 0.25, label: "0,25 кг" },
  { value: 0.5, label: "0,5 кг" },
  { value: 0.75, label: "0,75 кг" },
] as const;
const RATE_HINT: Record<number, string> = { 0.25: "спокойно", 0.5: "умеренно", 0.75: "быстро" };
const GOAL_HINT: Record<GoalKind, string> = {
  lose: "дефицит калорий с безопасным минимумом",
  maintain: "калории на уровне расхода",
  gain: "профицит калорий и больше белка",
};

const thisYear = new Date().getFullYear();
const [minYear, maxYear] = [thisYear - AGE_YEARS[1], thisYear - AGE_YEARS[0]];
const STEPS = ["Цель", "О себе", "Тело", "Активность", "Норма"];

/** Онбординг: цель → пол и год → рост и вес → активность → «Ваша норма». */
export function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<GoalKind | null>(null);
  const [rate, setRate] = useState<number>(0.5);
  const [target, setTarget] = useState("");
  const [sex, setSex] = useState<Sex | null>(null);
  const [birthYear, setBirthYear] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState<Activity | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const paceRef = useRef<HTMLDivElement>(null);

  // Выбрали «снизить/набрать» — темп и целевой вес появляются ниже; на маленьком
  // экране они под кнопкой, поэтому докручиваем до них (scroll-padding учитывает панель).
  useEffect(() => {
    paceRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [goal]);

  /** Новый шаг — с начала страницы, а не с места прокрутки прошлого. */
  function go(next: number) {
    setError("");
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  const by = parseNum(birthYear);
  const h = parseNum(height);
  const w = parseNum(weight);
  const t = parseNum(target);
  const inRange = (v: number | null, [min, max]: readonly [number, number]) => v != null && v >= min && v <= max;
  const valid = [
    goal != null && (goal === "maintain" || t == null || inRange(t, WEIGHT_KG)),
    sex != null && inRange(by, [minYear, maxYear]),
    inRange(h, HEIGHT_CM) && inRange(w, WEIGHT_KG),
    activity != null,
    true,
  ];
  // Почему «Дальше» не нажимается: иначе кнопка серая без объяснений.
  const warn = (text: string) => <span className="text-warn">{text}</span>;
  const kgRange = `от ${WEIGHT_KG[0]} до ${WEIGHT_KG[1]} кг`;

  const norms =
    goal && sex && by && h && w && activity
      ? computeNorms({ sex, age: thisYear - by, heightCm: h, weightKg: w, activity, goal, rateKgPerWeek: rate })
      : null;

  async function finish() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sex,
          birthYear: by,
          heightCm: h,
          activity,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          weightKg: w,
          goal: { kind: goal, rateKgPerWeek: goal === "maintain" ? null : rate, targetWeightKg: goal === "maintain" ? null : t },
        }),
      });
      if (res.ok) {
        // «Сохраняю…» остаётся до перехода: повторное нажатие записало бы вес второй раз.
        router.replace("/");
        router.refresh();
        return;
      }
      setError("Не получилось сохранить. Проверьте значения.");
    } catch {
      setError("Нет связи с сервером. Проверьте интернет и попробуйте снова.");
    }
    setSaving(false);
  }

  /** Вошли не с той почтой: до конца онбординга вкладок и настроек нет — выход здесь. */
  async function signOut() {
    setLeaving(true);
    setError("");
    try {
      await signOutAndClear();
      // Полная загрузка, а не router.replace: в памяти не остаётся ничего от этого входа.
      location.replace("/login");
    } catch {
      setError("Не получилось выйти. Проверьте интернет и попробуйте снова.");
      setLeaving(false);
    }
  }

  return (
    // Колонка на весь экран: короткий шаг не прокручивается, кнопка — в липкой панели внизу.
    <main className="mx-auto flex min-h-app max-w-xl flex-col px-6 pt-6">
      <div className="flex items-center gap-3">
        {step > 0 ? (
          <button type="button" onClick={() => go(step - 1)} className="text-[16px] font-semibold text-accent">
            ‹ Назад
          </button>
        ) : (
          <button type="button" disabled={leaving} onClick={signOut} className="text-[16px] font-semibold text-ink-3 disabled:opacity-50">
            Выйти
          </button>
        )}
        <div className="ml-auto flex gap-1.5">
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1.5 w-6 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} />
          ))}
        </div>
      </div>

      <Eyebrow className="mt-8">
        Шаг {step + 1} из {STEPS.length} · {STEPS[step].toLowerCase()}
      </Eyebrow>

      {/* pb-6: запас под затухание панели — последнее поле не прячется под ней в конце прокрутки */}
      <div className="mt-2 flex-1 pb-6">
        {step === 0 && (
          <>
            <h1 className="font-display text-[30px] leading-tight font-extrabold">Какая цель?</h1>
            <div className="mt-6 space-y-3">
              {(Object.keys(GOAL_RU) as GoalKind[]).map((g) => (
                <OptionCard key={g} selected={goal === g} onClick={() => setGoal(g)} title={GOAL_RU[g]} hint={GOAL_HINT[g]} />
              ))}
            </div>
            {goal && goal !== "maintain" && (
              <div ref={paceRef} className="mt-6 space-y-5">
                <div>
                  <p className="mb-2 text-[15px] font-semibold text-ink">
                    Темп в неделю <span className="font-normal text-ink-3">· {RATE_HINT[rate]}</span>
                  </p>
                  <Segmented value={rate} options={[...RATES]} onChange={setRate} />
                </div>
                <NumberField
                  label="Целевой вес"
                  unit="кг"
                  value={target}
                  onChange={setTarget}
                  placeholder="необязательно"
                  hint={outOfRange(t, ...WEIGHT_KG) && warn(`Целевой вес — ${kgRange}.`)}
                />
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="font-display text-[30px] leading-tight font-extrabold">О себе</h1>
            <p className="mt-2 text-[15px] text-ink-2">Пол и возраст нужны для расчёта обмена веществ и норм витаминов.</p>
            <div className="mt-6 space-y-5">
              <Segmented
                value={sex}
                options={[
                  { value: "female", label: "Женщина" },
                  { value: "male", label: "Мужчина" },
                ]}
                onChange={setSex}
              />
              <NumberField
                label="Год рождения"
                value={birthYear}
                onChange={setBirthYear}
                placeholder="1990"
                hint={
                  by != null && by > maxYear
                    ? warn(`Calo — для взрослых: нормы рассчитаны с ${AGE_YEARS[0]} лет.`)
                    : outOfRange(by, minYear, maxYear) && warn(`Год рождения — не раньше ${minYear}.`)
                }
              />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="font-display text-[30px] leading-tight font-extrabold">Рост и вес</h1>
            <p className="mt-2 text-[15px] text-ink-2">Вес можно обновлять в настройках — нормы пересчитаются.</p>
            <div className="mt-6 space-y-5">
              <NumberField
                label="Рост"
                unit="см"
                value={height}
                onChange={setHeight}
                placeholder="175"
                hint={outOfRange(h, ...HEIGHT_CM) && warn(`Рост — от ${HEIGHT_CM[0]} до ${HEIGHT_CM[1]} см.`)}
              />
              <NumberField
                label="Текущий вес"
                unit="кг"
                value={weight}
                onChange={setWeight}
                placeholder="70"
                hint={outOfRange(w, ...WEIGHT_KG) && warn(`Вес — ${kgRange}.`)}
              />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="font-display text-[30px] leading-tight font-extrabold">Активность</h1>
            <div className="mt-6 space-y-3">
              {(Object.keys(ACTIVITY_RU) as Activity[]).map((a) => (
                <OptionCard
                  key={a}
                  selected={activity === a}
                  onClick={() => setActivity(a)}
                  title={ACTIVITY_RU[a].title}
                  hint={ACTIVITY_RU[a].hint}
                />
              ))}
            </div>
          </>
        )}

        {step === 4 && norms && (
          <>
            <h1 className="font-display text-[30px] leading-tight font-extrabold">Ваша норма</h1>
            <div className="mt-6 flex flex-wrap items-baseline gap-x-3">
              <span className="tabular font-display text-[56px] leading-none font-extrabold">{formatInt(norms.kcal)}</span>
              <span className="text-[17px] text-ink-2">ккал в день</span>
            </div>
            <Eyebrow className="mt-3">
              коридор {formatInt(norms.kcalRange[0])}–{formatInt(norms.kcalRange[1])} ккал
            </Eyebrow>
            <dl className="mt-6 grid grid-cols-3 gap-2">
              {[
                ["Белок", norms.nutrients.protein!.value, "не меньше"],
                ["Жиры", norms.nutrients.fat!.value, "около"],
                ["Углеводы", norms.nutrients.carbs!.value, "около"],
              ].map(([label, value, note]) => (
                <div key={label} className="min-w-0 rounded-2xl bg-surface px-3 py-3">
                  <dt className="text-[13px] text-ink-3">{label}</dt>
                  <dd className="tabular mt-1 text-[22px] font-bold">
                    {formatInt(value as number)} <span className="text-[14px] font-normal text-ink-2">г</span>
                  </dd>
                  <dd className="text-[12px] text-ink-3">{note}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 text-[15px] leading-relaxed text-ink-2">
              Расход в покое {formatInt(norms.meta.bmr)} ккал, с учётом активности — {formatInt(norms.meta.tdee)} ккал.
              {goal === "lose" && !norms.meta.floorApplied && ` Дефицит под темп ${String(rate).replace(".", ",")} кг в неделю.`}
            </p>
            {norms.meta.floorApplied && (
              <p className="mt-3 rounded-2xl bg-warn/10 px-4 py-3 text-[15px] leading-snug text-ink">
                Такой темп требует слишком большого дефицита. Норма ограничена безопасным минимумом — снижение пойдёт медленнее.
              </p>
            )}
            <p className="mt-4 text-[13px] text-ink-3">
              Витамины и минералы — по нормам Роспотребнадзора (МР 2.3.1.0253-21). Любую норму можно поправить в настройках.
            </p>
          </>
        )}
      </div>

      <BottomBar>
        {error && <p className="mb-3 text-[15px] text-warn">{error}</p>}
        {step < 4 ? (
          <Button disabled={!valid[step]} onClick={() => go(step + 1)}>
            Дальше
          </Button>
        ) : (
          <Button disabled={saving || !norms} onClick={finish}>
            {saving ? "Сохраняю…" : "Начать"}
          </Button>
        )}
      </BottomBar>
    </main>
  );
}
