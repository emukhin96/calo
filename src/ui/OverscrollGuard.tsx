"use client";

import { useEffect } from "react";

/**
 * «Люфт» коротких экранов: Safari и WKWebView (приложение) пружинят всю страницу,
 * даже когда прокручивать нечего, — экран «плавает» под пальцем. Пока документ
 * умещается в экран, пружину у корня выключаем (overscroll-behavior-y: none,
 * iOS 16+); длинные страницы пружинят как обычно. Пока открыт лист
 * (BottomSheet ставит body.style.overflow = "hidden"), страница под ним тоже не
 * пружинит; прокрутка внутри листа — своя, её это не касается. Вбок страница не
 * пружинит никогда — это в globals.css.
 */
export function OverscrollGuard() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    // Без requestAnimationFrame: в фоне (приложение свёрнуто) кадров нет, и проверка
    // повисла бы до возврата. ResizeObserver и так зовёт не чаще раза в кадр.
    const check = () => {
      const fits = root.scrollHeight <= root.clientHeight + 1;
      const locked = body.style.overflow === "hidden";
      // Пустая строка — значение из CSS (auto): у длинной страницы обычная пружина.
      root.style.overscrollBehaviorY = fits || locked ? "none" : "";
    };

    check();
    // body — min-h-dvh: вырос выше экрана или сжался обратно до него — страница перестала или начала умещаться.
    const resize = new ResizeObserver(check);
    resize.observe(body);
    // Лист открылся или закрылся — body.style.overflow.
    const lock = new MutationObserver(check);
    lock.observe(body, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      resize.disconnect();
      lock.disconnect();
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
      root.style.overscrollBehaviorY = "";
    };
  }, []);

  return null;
}
