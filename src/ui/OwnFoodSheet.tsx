"use client";

import { type ReactNode, useRef, useState } from "react";
import type { FoodResult } from "@/db/foods";
import { kcalMismatch, OWN_FOOD_LIMITS, type OwnFoodField, type OwnFoodInput, ownFoodErrors } from "@/lib/own-food";
import { BottomSheet } from "./BottomSheet";
import { Button, Eyebrow } from "./components";
import { NumberField, parseNum } from "./form";

const num = (s: string) => parseNum(s) ?? NaN;
/** Ошибка под полем NumberField (у него подсказка серая). */
const warn = (text?: string) => (text ? <span className="text-warn">{text}</span> : undefined);

/**
 * Свой продукт «КБЖУ с упаковки»: когда в справочнике и Open Food Facts нет
 * нужного йогурта или масла. Сохраняется в личный справочник (POST /api/foods),
 * потом находится поиском и — если указан штрихкод — сканером.
 * Сохранить можно и из шапки: клавиатура закрывает низ листа.
 */
export function OwnFoodSheet({
  initialName = "",
  initialBarcode = "",
  note,
  onSaved,
  onClose,
}: {
  initialName?: string;
  initialBarcode?: string;
  /** Пояснение сверху: «Товара нет в Open Food Facts — перепишите КБЖУ с упаковки». */
  note?: string;
  onSaved: (food: FoodResult) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [brand, setBrand] = useState("");
  const [barcode, setBarcode] = useState(initialBarcode);
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");
  const [carbs, setCarbs] = useState("");
  const [portion, setPortion] = useState("");
  /** Ошибки пустых полей показываем после первой попытки сохранить. */
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const body = useRef<HTMLDivElement>(null);

  const input: OwnFoodInput = {
    nameRu: name,
    brand,
    barcode,
    per100g: { kcal: num(kcal), protein: num(protein), fat: num(fat), carbs: num(carbs) },
    defaultPortionG: portion.trim() ? num(portion) : null,
  };
  const errors = ownFoodErrors(input);
  const err = (f: OwnFoodField, filled: string) => (tried || filled.trim() ? errors[f] : undefined);
  const guess = kcalMismatch(input.per100g);

  async function save() {
    setTried(true);
    setError("");
    if (Object.keys(errors).length > 0) {
      // Первая ошибка может быть ниже края листа — показываем её.
      requestAnimationFrame(() => body.current?.querySelector(".text-warn")?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/foods", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nameRu: name.trim(),
        brand: brand.trim() || null,
        barcode: barcode || null,
        per100g: input.per100g,
        defaultPortionG: input.defaultPortionG,
      }),
    }).catch(() => null);
    const food = res?.ok ? ((await res.json().catch(() => null)) as FoodResult | null) : null;
    setBusy(false);
    if (!food) {
      setError(res ? "Не получилось сохранить — проверьте значения" : "Нет сети — не получилось сохранить");
      return;
    }
    onSaved(food);
  }

  return (
    <BottomSheet label="Свой продукт" onClose={onClose} dismissible={false}>
      <div className="flex shrink-0 items-center justify-between gap-3 px-6">
        <button type="button" onClick={onClose} className="py-1 text-[16px] font-semibold text-accent">
          Отмена
        </button>
        <span className="truncate text-[16px] font-bold text-ink">Свой продукт</span>
        <button type="button" onClick={save} disabled={busy} className="py-1 text-[16px] font-bold text-accent disabled:opacity-50">
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>

      <div ref={body} className="mt-3 min-h-0 overflow-y-auto overscroll-contain px-6 pb-2">
        {note && <p className="mb-2 rounded-2xl bg-surface px-4 py-3 text-[15px] leading-snug text-ink-2">{note}</p>}

        <TextField
          label="Название"
          value={name}
          onChange={setName}
          placeholder="Йогурт греческий 2%"
          maxLength={OWN_FOOD_LIMITS.name}
          error={tried ? errors.nameRu : undefined}
        />
        <TextField
          label="Бренд"
          optional
          value={brand}
          onChange={setBrand}
          placeholder="как на упаковке"
          maxLength={OWN_FOOD_LIMITS.brand}
          error={errors.brand}
        />
        <TextField
          label="Штрихкод"
          optional
          value={barcode}
          onChange={(v) => setBarcode(v.replace(/\D/g, "").slice(0, 14))}
          placeholder="цифры под штрихами"
          inputMode="numeric"
          error={err("barcode", barcode)}
          hint="С кодом продукт найдётся сканером"
        />

        <Eyebrow className="mt-6 !text-[13px]">КБЖУ на 100 г — с упаковки</Eyebrow>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <NumberField label="Калории" unit="ккал" value={kcal} onChange={setKcal} hint={warn(err("kcal", kcal))} />
          <NumberField label="Белки" unit="г" value={protein} onChange={setProtein} hint={warn(err("protein", protein))} />
          <NumberField label="Жиры" unit="г" value={fat} onChange={setFat} hint={warn(err("fat", fat))} />
          <NumberField label="Углеводы" unit="г" value={carbs} onChange={setCarbs} hint={warn(err("carbs", carbs))} />
        </div>
        {errors.macros && <p className="mt-2 text-[14px] leading-snug text-warn">{errors.macros}</p>}
        {guess != null && !errors.kcal && !errors.macros && (
          <p className="mt-2 text-[14px] leading-snug text-ink-2">
            По белкам, жирам и углеводам выходит около {guess} ккал — проверьте, нет ли опечатки.
          </p>
        )}

        <div className="mt-4">
          <NumberField
            label="Порция"
            unit="г"
            value={portion}
            onChange={setPortion}
            placeholder="необязательно"
            hint={warn(err("defaultPortionG", portion)) ?? "Упаковка или штука — станет быстрой кнопкой"}
          />
        </div>

        {error && <p className="mt-4 text-[15px] text-warn">{error}</p>}
        <Button className="mt-6" disabled={busy} onClick={save}>
          {busy ? "Сохраняю…" : "Сохранить продукт"}
        </Button>
      </div>
    </BottomSheet>
  );
}

function TextField({
  label,
  optional,
  value,
  onChange,
  placeholder,
  inputMode,
  maxLength,
  error,
  hint,
}: {
  label: string;
  optional?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "text";
  maxLength?: number;
  error?: string;
  hint?: ReactNode;
}) {
  return (
    <label className="mt-4 block">
      <span className="text-[15px] font-semibold text-ink">
        {label}
        {optional && <span className="font-normal text-ink-3"> · необязательно</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete="off"
        enterKeyHint="next"
        className={`${inputMode === "numeric" ? "tabular " : ""}mt-1.5 h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-[17px] text-ink outline-none placeholder:text-ink-3/60 focus:border-accent`}
      />
      {(error || hint) && <span className={`mt-1 block text-[13px] ${error ? "text-warn" : "text-ink-3"}`}>{error ?? hint}</span>}
    </label>
  );
}
