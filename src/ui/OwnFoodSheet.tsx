"use client";

import { type ReactNode, useRef, useState } from "react";
import type { ParseLabelResponse } from "@/app/api/parse/label/route";
import type { FoodResult } from "@/db/foods";
import {
  kcalMismatch,
  type LabelBasis,
  OWN_FOOD_LIMITS,
  type OwnFoodField,
  type OwnFoodInput,
  ownFoodErrors,
  per100FromServing,
  servingError,
} from "@/lib/own-food";
import { BottomSheet } from "./BottomSheet";
import { Button, Eyebrow } from "./components";
import { NumberField, parseNum, Segmented } from "./form";
import { compressImage } from "./image";

const num = (s: string) => parseNum(s) ?? NaN;
/** Ошибка под полем NumberField (у него подсказка серая). */
const warn = (text?: string) => (text ? <span className="text-warn">{text}</span> : undefined);
/** 12.5 → «12,5» — как вводят в поле. */
const field = (x: number | null | undefined) => (x == null ? "" : String(Math.round(x * 10) / 10).replace(".", ","));

const BASES: { value: LabelBasis; label: string }[] = [
  { value: "100g", label: "На 100 г" },
  { value: "serving", label: "На порцию" },
];

/** Что сказать после фото этикетки: прочитали (проверить цифры) или не вышло. */
type PhotoState = { status: "reading" } | { status: "done" } | { status: "error"; text: string };

/**
 * Свой продукт «КБЖУ с упаковки»: когда в справочнике и Open Food Facts нет
 * нужного йогурта или масла. Сохраняется в личный справочник (POST /api/foods),
 * потом находится поиском и — если указан штрихкод — сканером.
 * Значения — на 100 г или на порцию (канадские и американские этикетки:
 * «Per 1 cup (250 mL)») — тогда пересчитываются на 100 г. Поля можно заполнить
 * по фото этикетки (/api/parse/label): ИИ переписывает цифры, человек сверяет.
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
  const [basis, setBasis] = useState<LabelBasis>("100g");
  /** Порция, на которую даны значения на этикетке, — для basis «serving». */
  const [serving, setServing] = useState("");
  const [photo, setPhoto] = useState<PhotoState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Ошибки пустых полей показываем после первой попытки сохранить. */
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const body = useRef<HTMLDivElement>(null);

  const entered = { kcal: num(kcal), protein: num(protein), fat: num(fat), carbs: num(carbs) };
  const perServing = basis === "serving";
  const servingG = num(serving);
  const input: OwnFoodInput = {
    nameRu: name,
    brand,
    barcode,
    per100g: perServing ? per100FromServing(entered, servingG) : entered,
    // Порция с этикетки — и быстрая кнопка граммов, если свою не указали.
    defaultPortionG: portion.trim() ? num(portion) : perServing && Number.isFinite(servingG) ? servingG : null,
  };
  const errors = ownFoodErrors(input);
  const servingErr = perServing ? servingError(servingG) : undefined;
  const err = (f: OwnFoodField, filled: string) => {
    if (!(tried || filled.trim())) return undefined;
    // На порцию число может быть в пределах, а на 100 г — нет: дело в порции или опечатке.
    if (perServing && errors[f] && f !== "nameRu" && Number.isFinite(entered[f as keyof typeof entered])) {
      return servingErr ? undefined : "На 100 г выходит слишком много — проверьте порцию";
    }
    return errors[f];
  };
  const guess = kcalMismatch(input.per100g);
  const converted = perServing && !servingErr && Object.keys(errors).every((k) => k === "nameRu" || k === "brand" || k === "barcode" || k === "defaultPortionG");

  /** Фото этикетки → поля формы; название и бренд — только если их ещё не вписали. */
  async function readLabel(file: File) {
    setPhoto({ status: "reading" });
    const image = await compressImage(file).catch(() => null);
    if (!image) {
      setPhoto({ status: "error", text: "Не получилось открыть фото — попробуйте другое." });
      return;
    }
    const res = await fetch("/api/parse/label", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image, mimeType: "image/jpeg" }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => ({}))) as Partial<ParseLabelResponse> & { error?: string }) : null;
    if (!res?.ok || !data || data.kcal == null) {
      setPhoto({ status: "error", text: data?.error ?? "Нет сети — перепишите цифры вручную." });
      return;
    }
    if (data.name && !name.trim()) setName(data.name.slice(0, OWN_FOOD_LIMITS.name));
    if (data.brand && !brand.trim()) setBrand(data.brand.slice(0, OWN_FOOD_LIMITS.brand));
    setBasis(data.basis === "serving" ? "serving" : "100g");
    setServing(data.basis === "serving" ? field(data.servingG) : "");
    if (data.basis !== "serving" && data.servingG && !portion.trim()) setPortion(field(data.servingG));
    setKcal(field(data.kcal));
    setProtein(field(data.protein));
    setFat(field(data.fat));
    setCarbs(field(data.carbs));
    setPhoto({ status: "done" });
  }

  async function save() {
    setTried(true);
    setError("");
    if (Object.keys(errors).length > 0 || servingErr) {
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

        <div className="mt-6 flex items-baseline justify-between gap-3">
          <Eyebrow className="!text-[13px]">КБЖУ — с упаковки</Eyebrow>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={photo?.status === "reading"}
            className="shrink-0 text-[15px] font-semibold text-accent disabled:opacity-50"
          >
            {photo?.status === "reading" ? "Читаю этикетку…" : "По фото этикетки"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // то же фото ещё раз — снова событие
              if (file) void readLabel(file);
            }}
          />
        </div>
        {photo?.status === "done" && (
          <p className="mt-2 rounded-2xl bg-surface px-4 py-3 text-[14px] leading-snug text-ink-2">
            Цифры переписал ИИ с фото — сверьте их с этикеткой перед сохранением.
          </p>
        )}
        {photo?.status === "error" && <p className="mt-2 text-[14px] leading-snug text-warn">{photo.text}</p>}
        <div className="mt-3">
          <Segmented value={basis} options={BASES} onChange={setBasis} />
        </div>
        {perServing && (
          <div className="mt-3">
            <NumberField
              label="Порция на этикетке"
              unit="г"
              value={serving}
              onChange={setServing}
              placeholder="например, 250"
              hint={warn(tried || serving.trim() ? servingErr : undefined) ?? "«Per 1 cup (250 mL)» — 250; миллилитры считаем граммами"}
            />
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumberField label="Калории" unit="ккал" value={kcal} onChange={setKcal} hint={warn(err("kcal", kcal))} />
          <NumberField label="Белки" unit="г" value={protein} onChange={setProtein} hint={warn(err("protein", protein))} />
          <NumberField label="Жиры" unit="г" value={fat} onChange={setFat} hint={warn(err("fat", fat))} />
          <NumberField label="Углеводы" unit="г" value={carbs} onChange={setCarbs} hint={warn(err("carbs", carbs))} />
        </div>
        {errors.macros && !servingErr && (
          <p className="mt-2 text-[14px] leading-snug text-warn">
            {perServing ? "На 100 г белков, жиров и углеводов выходит больше 100 г — проверьте порцию и цифры" : errors.macros}
          </p>
        )}
        {converted && (
          <p className="tabular mt-2 text-[14px] leading-snug text-ink-2">
            На 100 г: {field(input.per100g.kcal)} ккал · Б {field(input.per100g.protein)} · Ж {field(input.per100g.fat)} · У{" "}
            {field(input.per100g.carbs)}
          </p>
        )}
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
            placeholder={perServing && serving.trim() ? serving : "необязательно"}
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
