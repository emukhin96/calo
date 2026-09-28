import { ImageResponse } from "next/og";

/**
 * Иконка приложения: синий квадрат с белым незамкнутым кольцом «прогресса дня».
 * Рисуется в PNG при запросе (next/og), отдельные файлы иконок не храним.
 * maskable: с запасом по краям — Android обрезает иконку в круг.
 */
export function appIcon(size: number, { maskable = false } = {}) {
  const ring = Math.round(size * (maskable ? 0.46 : 0.56));
  const stroke = Math.round(size * 0.1);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2438d6",
        }}
      >
        <div
          style={{
            width: ring,
            height: ring,
            borderRadius: "50%",
            border: `${stroke}px solid #ffffff`,
            borderRightColor: "rgba(255,255,255,0.28)",
            transform: "rotate(-45deg)",
          }}
        />
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
  );
}
