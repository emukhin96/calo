"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ACTIVITY_RU,
  type Activity,
  computeNorms,
  GOAL_RU,
  type GoalKind,
  type Sex,
} from "@/domain/norms";
import { Button, Eyebrow } from "@/ui/components";
import { NumberField, OptionCard, parseNum, Segmented } from "@/ui/form";
import { formatInt } from "@/ui/format";

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
  const [error, setError] = useState("");

  const by = parseNum(birthYear);
  const h = parseNum(height);
  const w = parseNum(weight);
  const t = parseNum(target);
  const valid = [
    goal != null && (goal === "maintain" || t == null || (t >= 30 && t <= 300)),
    sex != null && by != null && by >= thisYear - 100 && by <= thisYear - 18,
    h != null && h >= 120 && h <= 230 && w != null && w >= 30 && w <= 300,
    activity != null,
    true,
  ];

  const norms =
    goal && sex && by && h && w && activity
      ? computeNorms({ sex, age: thisYear - by, heightCm: h, weightKg: w, activity, goal, rateKgPerWeek: rate })
      : null;

  async function finish() {
    setSaving(true);
    setError("");
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
    if (!res.ok) {
      setSaving(false);
      setError("Не получилось сохранить. Проверьте значения.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-6 pt-6 pb-[calc(24px+env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-3">
        {step > 0 ? (
          <button type="button" onClick={() => setStep(step - 1)} className="text-[16px] font-semibold text-accent">
            ‹ Назад
          </button>
        ) : (
          <span className="h-6" />
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

      <div className="mt-2 flex-1">
        {step === 0 && (
          <>
            <h1 className="font-display text-[30px] leading-tight font-extrabold">Какая цель?</h1>
            <div className="mt-6 space-y-3">
              {(Object.keys(GOAL_RU) as GoalKind[]).map((g) => (
                <OptionCard key={g} selected={goal === g} onClick={() => setGoal(g)} title={GOAL_RU[g]} hint={GOAL_HINT[g]} />
              ))}
            </div>
            {goal && goal !== "maintain" && (
              <div className="mt-6 space-y-5">
                <div>
                  <p className="mb-2 text-[15px] font-semibold text-ink">
                    Темп в неделю <span className="font-normal text-ink-3">· {RATE_HINT[rate]}</span>
                  </p>
                  <Segmented value={rate} options={[...RATES]} onChange={setRate} />
                </div>
                <NumberField label="Целевой вес" unit="кг" value={target} onChange={setTarget} placeholder="необязательно" />
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
              <NumberField label="Год рождения" value={birthYear} onChange={setBirthYear} placeholder="1990" />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="font-display text-[30px] leading-tight font-extrabold">Рост и вес</h1>
            <p className="mt-2 text-[15px] text-ink-2">Вес можно обновлять в настройках — нормы пересчитаются.</p>
            <div className="mt-6 space-y-5">
              <NumberField label="Рост" unit="см" value={height} onChange={setHeight} placeholder="175" />
              <NumberField label="Текущий вес" unit="кг" value={weight} onChange={setWeight} placeholder="70" />
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
            <dl className="mt-6 grid grid-cols-3 gap-3">
              {[
                ["Белок", norms.nutrients.protein!.value, "не меньше"],
                ["Жиры", norms.nutrients.fat!.value, "около"],
                ["Углеводы", norms.nutrients.carbs!.value, "около"],
              ].map(([label, value, note]) => (
                <div key={label} className="rounded-2xl bg-surface px-4 py-3">
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

      {error && <p className="mb-3 text-[15px] text-warn">{error}</p>}
      {step < 4 ? (
        <Button disabled={!valid[step]} onClick={() => setStep(step + 1)}>
          Дальше
        </Button>
      ) : (
        <Button disabled={saving || !norms} onClick={finish}>
          {saving ? "Сохраняю…" : "Начать"}
        </Button>
      )}
    </main>
  );
}
