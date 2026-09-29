"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GoalInput, ProfileInput } from "@/db/profile";
import { ACTIVITY_RU, type Activity, GOAL_RU, type GoalKind, type Norms, type Sex } from "@/domain/norms";
import { NUTRIENT_KEYS, type NutrientKey } from "@/domain/nutrients";
import { authClient } from "@/lib/auth-client";
import { Button, Eyebrow, SectionTitle } from "@/ui/components";
import { NumberField, OptionCard, parseNum, Segmented } from "@/ui/form";
import { formatInt } from "@/ui/format";
import { fmtAmount, NUTRIENT_LABELS, unitRu } from "@/ui/nutrients";
import { PushToggle } from "@/ui/PushToggle";

type Weight = { id: string; kg: number; at: string };
type Props = {
  email: string;
  profile: ProfileInput;
  goal: GoalInput;
  weights: Weight[];
  norms: Norms;
  overrides: Partial<Record<NutrientKey, number>>;
};

const KIND_RU = { min: "не меньше", target: "около", limit: "не больше" } as const;
const RATES = [
  { value: 0.25, label: "0,25 кг" },
  { value: 0.5, label: "0,5 кг" },
  { value: 0.75, label: "0,75 кг" },
];

export function Settings(p: Props) {
  const router = useRouter();
  const [goal, setGoal] = useState<GoalKind>(p.goal.kind);
  const [rate, setRate] = useState(p.goal.rateKgPerWeek ?? 0.5);
  const [target, setTarget] = useState(p.goal.targetWeightKg ? String(p.goal.targetWeightKg) : "");
  const [sex, setSex] = useState<Sex>(p.profile.sex);
  const [birthYear, setBirthYear] = useState(String(p.profile.birthYear));
  const [height, setHeight] = useState(String(p.profile.heightCm));
  const [activity, setActivity] = useState<Activity>(p.profile.activity);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const dirty =
    goal !== p.goal.kind ||
    (goal !== "maintain" && rate !== p.goal.rateKgPerWeek) ||
    parseNum(target) !== (p.goal.targetWeightKg ?? null) ||
    sex !== p.profile.sex ||
    parseNum(birthYear) !== p.profile.birthYear ||
    parseNum(height) !== p.profile.heightCm ||
    activity !== p.profile.activity;

  async function saveProfile() {
    setSaving(true);
    setMessage("");
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sex,
        birthYear: parseNum(birthYear),
        heightCm: parseNum(height),
        activity,
        timezone: p.profile.timezone,
        goal: {
          kind: goal,
          rateKgPerWeek: goal === "maintain" ? null : rate,
          targetWeightKg: goal === "maintain" ? null : parseNum(target),
        },
      }),
    });
    setSaving(false);
    setMessage(res.ok ? "Сохранено, нормы пересчитаны" : "Не получилось сохранить — проверьте значения");
    if (res.ok) router.refresh();
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
  }

  return (
    <main className="mx-auto max-w-xl px-6 pt-6 pb-24">
      <div className="flex items-center justify-between">
        <Eyebrow>Настройки</Eyebrow>
        <Link href="/" className="text-[16px] font-semibold text-accent">
          Готово
        </Link>
      </div>

      <div className="mt-4 rounded-2xl bg-surface px-5 py-4">
        <div className="flex items-baseline gap-2">
          <span className="tabular font-display text-[34px] font-extrabold">{formatInt(p.norms.kcal)}</span>
          <span className="text-[15px] text-ink-2">ккал в день</span>
        </div>
        <p className="mt-1 text-[14px] text-ink-3">
          белок {formatInt(p.norms.nutrients.protein?.value ?? 0)} г · жиры {formatInt(p.norms.nutrients.fat?.value ?? 0)} г ·
          углеводы {formatInt(p.norms.nutrients.carbs?.value ?? 0)} г
        </p>
        {p.norms.meta.floorApplied && (
          <p className="mt-2 text-[14px] text-warn">Темп ограничен безопасным минимумом калорий.</p>
        )}
      </div>

      <SectionTitle>Цель</SectionTitle>
      <div className="space-y-3">
        {(Object.keys(GOAL_RU) as GoalKind[]).map((g) => (
          <OptionCard key={g} selected={goal === g} onClick={() => setGoal(g)} title={GOAL_RU[g]} />
        ))}
      </div>
      {goal !== "maintain" && (
        <div className="mt-5 space-y-5">
          <div>
            <p className="mb-2 text-[15px] font-semibold">Темп в неделю</p>
            <Segmented value={rate} options={RATES} onChange={setRate} />
          </div>
          <NumberField label="Целевой вес" unit="кг" value={target} onChange={setTarget} placeholder="необязательно" />
        </div>
      )}

      <SectionTitle>О себе</SectionTitle>
      <div className="space-y-5">
        <Segmented
          value={sex}
          options={[
            { value: "female", label: "Женщина" },
            { value: "male", label: "Мужчина" },
          ]}
          onChange={setSex}
        />
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Год рождения" value={birthYear} onChange={setBirthYear} />
          <NumberField label="Рост" unit="см" value={height} onChange={setHeight} />
        </div>
        <div className="space-y-3">
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
      </div>

      {(dirty || message) && (
        <div className="sticky bottom-[calc(12px+env(safe-area-inset-bottom))] mt-6">
          {dirty && (
            <Button disabled={saving} onClick={saveProfile}>
              {saving ? "Сохраняю…" : "Сохранить и пересчитать нормы"}
            </Button>
          )}
          {message && !dirty && <p className="rounded-2xl bg-surface px-4 py-3 text-center text-[15px] text-ink-2 shadow">{message}</p>}
        </div>
      )}

      <WeightSection weights={p.weights} />
      <NormsSection norms={p.norms} overrides={p.overrides} />

      <SectionTitle>Уведомления</SectionTitle>
      <PushToggle />

      <SectionTitle>Данные</SectionTitle>
      <a href="/api/export" download className="text-[16px] font-semibold text-accent">
        Скачать дневник (CSV) →
      </a>
      <p className="mt-1 text-[13px] text-ink-3">Все записи с КБЖУ и витаминами — открывается в Excel и Numbers.</p>

      <SectionTitle>Аккаунт</SectionTitle>
      <p className="text-[15px] text-ink-2">{p.email}</p>
      <p className="mt-1 text-[14px] text-ink-3">Часовой пояс: {p.profile.timezone}</p>
      <button type="button" onClick={signOut} className="mt-4 text-[16px] font-semibold text-warn">
        Выйти
      </button>
    </main>
  );
}

function WeightSection({ weights }: { weights: Weight[] }) {
  const router = useRouter();
  const [kg, setKg] = useState("");
  const [busy, setBusy] = useState(false);
  const value = parseNum(kg);
  const current = weights.at(-1);

  async function add() {
    setBusy(true);
    const res = await fetch("/api/weight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kg: value }),
    });
    setBusy(false);
    if (res.ok) {
      setKg("");
      router.refresh();
    }
  }

  async function remove(id: string) {
    await fetch(`/api/weight/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <>
      <SectionTitle>Вес</SectionTitle>
      {current && (
        <p className="text-[15px] text-ink-2">
          Сейчас <b className="text-ink">{fmtAmount(current.kg)} кг</b> · {new Date(current.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
        </p>
      )}
      <WeightChart weights={weights} />
      <div className="mt-4 flex items-end gap-3">
        <div className="flex-1">
          <NumberField label="Новое взвешивание" unit="кг" value={kg} onChange={setKg} placeholder={current ? String(current.kg) : "70"} />
        </div>
        <button
          type="button"
          disabled={busy || value == null || value < 30 || value > 300}
          onClick={add}
          className="h-[58px] rounded-2xl bg-accent px-5 text-[16px] font-bold text-white disabled:opacity-40"
        >
          Записать
        </button>
      </div>
      {weights.length > 1 && (
        <ul className="mt-4 divide-y divide-line text-[15px]">
          {weights
            .slice(-5)
            .reverse()
            .map((w) => (
              <li key={w.id} className="flex items-center justify-between py-2">
                <span className="text-ink-2">{new Date(w.at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</span>
                <span className="tabular ml-auto font-semibold">{fmtAmount(w.kg)} кг</span>
                <button type="button" aria-label="Удалить" onClick={() => remove(w.id)} className="ml-4 text-ink-3">
                  ×
                </button>
              </li>
            ))}
        </ul>
      )}
    </>
  );
}

/** Линия веса по датам (без библиотек): мин/макс подписаны. */
function WeightChart({ weights }: { weights: Weight[] }) {
  if (weights.length < 2) return null;
  const W = 320;
  const H = 90;
  const xs = weights.map((w) => new Date(w.at).getTime());
  const ys = weights.map((w) => w.kg);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const px = (x: number) => (x1 === x0 ? W / 2 : ((x - x0) / (x1 - x0)) * (W - 16) + 8);
  const py = (y: number) => (y1 === y0 ? H / 2 : H - 10 - ((y - y0) / (y1 - y0)) * (H - 20));
  const points = weights.map((w, i) => `${px(xs[i])},${py(w.kg)}`).join(" ");
  return (
    <div className="mt-3 rounded-2xl bg-surface p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="График веса">
        <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {weights.map((w, i) => (
          <circle key={w.id} cx={px(xs[i])} cy={py(w.kg)} r="3" fill="var(--color-accent)" />
        ))}
      </svg>
      <div className="flex justify-between font-mono text-[12px] text-ink-3">
        <span>мин {fmtAmount(y0)} кг</span>
        <span>макс {fmtAmount(y1)} кг</span>
      </div>
    </div>
  );
}

function NormsSection({ norms, overrides }: { norms: Norms; overrides: Partial<Record<NutrientKey, number>> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<NutrientKey | null>(null);
  const [value, setValue] = useState("");
  const keys = NUTRIENT_KEYS.filter((k) => norms.nutrients[k]);

  async function save(nutrient: NutrientKey, v: number | null) {
    const res = await fetch("/api/norms/overrides", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nutrient, value: v }),
    });
    if (res.ok) {
      setEditing(null);
      router.refresh();
    }
  }

  return (
    <>
      <SectionTitle>Нормы</SectionTitle>
      <p className="-mt-2 mb-3 text-[14px] text-ink-3">
        Витамины и минералы — МР 2.3.1.0253-21. Нажмите, чтобы задать свою норму.
      </p>
      <ul className="divide-y divide-line">
        {keys.map((k) => {
          const n = norms.nutrients[k]!;
          const own = overrides[k] != null;
          return (
            <li key={k} className="py-2.5">
              {editing === k ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[15px] font-semibold">{NUTRIENT_LABELS[k]}</span>
                  <input
                    autoFocus
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))}
                    className="tabular w-24 rounded-xl border border-line bg-surface px-3 py-1.5 text-right text-[15px] outline-none focus:border-accent"
                  />
                  <span className="w-8 text-[14px] text-ink-3">{unitRu(k)}</span>
                  <button
                    type="button"
                    disabled={parseNum(value) == null}
                    onClick={() => save(k, parseNum(value))}
                    className="rounded-xl bg-accent px-3 py-1.5 text-[14px] font-bold text-white disabled:opacity-40"
                  >
                    OK
                  </button>
                  {own && (
                    <button type="button" onClick={() => save(k, null)} className="text-[13px] text-ink-3">
                      сброс
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(k);
                    setValue(String(n.value).replace(".", ","));
                  }}
                  className="flex w-full items-baseline gap-2 text-left"
                >
                  <span className="flex-1 text-[15px] text-ink">
                    {NUTRIENT_LABELS[k]}
                    {own && <span className="ml-2 font-mono text-[11px] text-accent uppercase">моя</span>}
                  </span>
                  <span className="text-[13px] text-ink-3">{KIND_RU[n.kind]}</span>
                  <span className="tabular w-24 text-right text-[15px] font-semibold">
                    {fmtAmount(n.value)} {unitRu(k)}
                  </span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
