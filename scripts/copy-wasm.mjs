// Кладёт распознаватель штрихкодов (zxing-wasm) в public/wasm — отдаём его сами,
// а не с jsDelivr (по умолчанию библиотека тянет оттуда). Вызывается из build и dev.
import { copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

// pnpm: зависимости пакета лежат рядом с ним — …/node_modules/{barcode-detector,zxing-wasm}.
const bd = realpathSync(path.join(process.cwd(), "node_modules/barcode-detector"));
const src = path.join(path.dirname(bd), "zxing-wasm/dist/reader/zxing_reader.wasm");
if (!existsSync(src)) throw new Error(`zxing_reader.wasm не найден: ${src}`);
const out = path.join(process.cwd(), "public/wasm");
mkdirSync(out, { recursive: true });
copyFileSync(src, path.join(out, "zxing_reader.wasm"));
console.log("[wasm] public/wasm/zxing_reader.wasm");
