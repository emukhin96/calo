"use client";

import { useEffect, useRef, useState } from "react";
import { useKeyboardInset } from "./useKeyboardInset";

type Props = { onCode: (code: string) => void; onClose: () => void };

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

/**
 * Сканер штрихкода камерой. Родной BarcodeDetector, где он есть (Chrome/Android),
 * иначе — zxing-wasm (Safari/iOS); файл распознавателя отдаём сами (/wasm).
 * Если камеры нет или доступ запрещён — ручной ввод кода.
 */
export function BarcodeScanner({ onCode, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const done = useRef(false);
  const keyboard = useKeyboardInset();
  // Камера запускается один раз: новый onCode (родитель перерисовался) её не перезапускает.
  const found = useRef(onCode);
  useEffect(() => {
    found.current = onCode;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
        prepareZXingModule({
          overrides: {
            locateFile: (file: string, prefix: string) => (file.endsWith(".wasm") ? `/wasm/${file}` : prefix + file),
          },
        });
        const detector = new BarcodeDetector({ formats: [...FORMATS] });

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();

        // ~3 кадра в секунду: хватает, чтобы поймать код, и не греет телефон.
        const tick = async () => {
          if (cancelled || done.current || !video.current) return;
          try {
            const [hit] = await detector.detect(video.current);
            if (hit?.rawValue && /^\d{8,14}$/.test(hit.rawValue)) {
              done.current = true;
              navigator.vibrate?.(40);
              found.current(hit.rawValue);
              return;
            }
          } catch {
            // кадр ещё не готов — пропускаем
          }
          timer = setTimeout(tick, 300);
        };
        tick();
      } catch (e) {
        const name = (e as Error).name;
        setError(
          name === "NotAllowedError"
            ? "Нет доступа к камере. Разрешите его в настройках Safari или введите код вручную."
            : name === "NotFoundError"
              ? "Камера не найдена — введите код вручную."
              : "Камера недоступна — введите код вручную.",
        );
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const manualOk = /^\d{8,14}$/.test(manual);

  return (
    // Клавиатура ручного ввода ложится поверх экрана — поле поднимаем над ней (как BottomSheet).
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" style={keyboard ? { paddingBottom: keyboard } : undefined}>
      <div className="flex items-center justify-between px-5 pt-[calc(16px+env(safe-area-inset-top))] pb-3">
        <span className="text-[17px] font-bold">Штрихкод</span>
        <button type="button" onClick={onClose} className="text-[16px] font-semibold text-white/80">
          Закрыть
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" />
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-36 w-[78%] max-w-sm rounded-2xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}
        <p className="absolute inset-x-0 bottom-6 px-8 text-center text-[15px] text-white/85">
          {error ?? "Наведите камеру на штрихкод на упаковке"}
        </p>
      </div>

      <form
        className="flex gap-2 bg-black px-5 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
        style={keyboard ? { paddingBottom: 12 } : undefined}
        onSubmit={(e) => {
          e.preventDefault();
          if (manualOk) onCode(manual);
        }}
      >
        <input
          inputMode="numeric"
          placeholder="или введите цифры кода"
          value={manual}
          onChange={(e) => setManual(e.target.value.replace(/\D/g, "").slice(0, 14))}
          className="tabular h-12 min-w-0 flex-1 rounded-xl bg-white/10 px-4 text-[17px] text-white outline-none placeholder:text-white/40"
        />
        <button type="submit" disabled={!manualOk} className="shrink-0 rounded-xl bg-accent px-4 text-[16px] font-bold disabled:opacity-40">
          Найти
        </button>
      </form>
    </div>
  );
}
