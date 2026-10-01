// Страна, где пользователь покупает еду, — по часовому поясу профиля (его
// обновляет телефон: прилетел в Торонто — пояс America/Toronto, страна — Канада).
// Нужна, чтобы в Open Food Facts сначала показывать товары с местных полок, и
// чтобы искать по названиям на местном языке (армянском, французском).

export type ShopCountry = {
  /** Тег страны в Open Food Facts: countries_tags = en:<tag>. */
  tag: string;
  /** Языки названий товаров на полках, кроме русского и английского. */
  langs: string[];
};

const ARMENIA: ShopCountry = { tag: "armenia", langs: ["hy"] };
const CANADA: ShopCountry = { tag: "canada", langs: ["fr"] };

const CANADA_ZONES = new Set(
  [
    "Toronto", "Vancouver", "Edmonton", "Winnipeg", "Halifax", "St_Johns", "Regina", "Moncton", "Whitehorse",
    "Yellowknife", "Iqaluit", "Glace_Bay", "Goose_Bay", "Swift_Current", "Dawson_Creek", "Dawson", "Fort_Nelson",
    "Creston", "Cambridge_Bay", "Rankin_Inlet", "Resolute", "Inuvik", "Atikokan", "Coral_Harbour", "Blanc-Sablon",
    "Nipigon", "Thunder_Bay", "Rainy_River", "Pangnirtung", "Montreal",
  ].map((z) => `America/${z}`),
);

const BY_ZONE: Record<string, ShopCountry> = {
  "Asia/Yerevan": ARMENIA,
  "Europe/Moscow": { tag: "russia", langs: [] },
  "Asia/Tbilisi": { tag: "georgia", langs: ["ka"] },
  "Europe/Minsk": { tag: "belarus", langs: [] },
  "Asia/Almaty": { tag: "kazakhstan", langs: ["kk"] },
};

/** Страна по поясу; null — пояс не сопоставлен, ищем без предпочтения страны. */
export function shopCountry(timeZone: string | null | undefined): ShopCountry | null {
  if (!timeZone) return null;
  if (CANADA_ZONES.has(timeZone) || timeZone.startsWith("Canada/")) return CANADA;
  return BY_ZONE[timeZone] ?? null;
}
