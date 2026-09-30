"use client";

import { useSyncExternalStore } from "react";

/**
 * Меньше — это не клавиатура, а панели Safari: они прячутся и появляются при
 * прокрутке и тоже меняют видимую область на несколько десятков пикселей.
 */
const MIN_KEYBOARD_PX = 80;

function subscribe(onChange: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
}

function snapshot(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const px = Math.round(window.innerHeight - vv.height - vv.offsetTop);
  return px < MIN_KEYBOARD_PX ? 0 : px;
}

/**
 * Сколько пикселей снизу закрывает экранная клавиатура. На iOS (Safari и
 * WKWebView приложения) она не сжимает страницу, а ложится поверх: position:
 * fixed-лист снизу оказывается под ней. Видимая часть — visualViewport; всё,
 * что ниже неё, — клавиатура. Клавиатура закрыта, на сервере и без
 * visualViewport — 0.
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
