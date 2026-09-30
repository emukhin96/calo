// Прогон эталонных фраз (src/ai/fixtures/phrases.ts) через настоящий Gemini.
// Запуск: scripts/ai-eval.command (спросит ключ) или
//   GEMINI_API_KEY=… pnpm exec tsx --conditions=react-server scripts/ai-eval.ts
// Считает: сколько ожидаемых позиций найдено (название) и попал ли вес в допуск; печатает расхождения.
import { generateJson } from "../src/ai/gemini";
import { parseFoodText } from "../src/ai/parse-text";
import { PHRASES } from "../src/ai/fixtures/phrases";

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY не задан");
    process.exit(2);
  }
  let expected = 0;
  let foundName = 0;
  let foundGrams = 0;
  let extra = 0;
  let failures = 0;
  const t0 = Date.now();
  for (const p of PHRASES) {
    let items;
    try {
      items = await parseFoodText(p.text, generateJson);
    } catch (e) {
      failures++;
      console.log(`✗ ${p.text}\n    ошибка: ${(e as Error).message}`);
      continue;
    }
    const used = new Set<number>();
    const lines: string[] = [];
    for (const ex of p.expect) {
      expected++;
      const idx = items.findIndex((it, i) => !used.has(i) && ex.name.test(it.name.toLowerCase()));
      if (idx < 0) {
        lines.push(`    нет позиции ${ex.name}`);
        continue;
      }
      used.add(idx);
      foundName++;
      const it = items[idx];
      if (it.grams >= ex.grams[0] && it.grams <= ex.grams[1]) foundGrams++;
      else lines.push(`    ${it.name}: ${it.grams} г, ожидалось ${ex.grams[0]}–${ex.grams[1]}`);
    }
    const unexpected = items.filter((_, i) => !used.has(i));
    extra += unexpected.length;
    if (unexpected.length) lines.push(`    лишнее: ${unexpected.map((u) => `${u.name} ${u.grams} г`).join(", ")}`);
    console.log(`${lines.length ? "•" : "✓"} ${p.text} → ${items.map((i) => `${i.name}${i.brand ? ` (${i.brand})` : ""}${i.nameEn ? ` [${i.nameEn}]` : ""} ${i.grams} г`).join("; ") || "—"}`);
    for (const l of lines) console.log(l);
  }
  console.log(`\nФраз: ${PHRASES.length}, ошибок вызова: ${failures}, время: ${Math.round((Date.now() - t0) / 1000)} с`);
  console.log(`Позиции найдены: ${foundName}/${expected}; вес в допуске: ${foundGrams}/${expected}; лишних позиций: ${extra}`);
}

main();
