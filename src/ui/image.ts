// Фото с камеры телефона — 3–12 МБ; ИИ хватает 1568 px по длинной стороне
// (docs/ARCHITECTURE.md §5, «Фото»). Сжимаем на клиенте в JPEG перед отправкой.

const MAX_SIDE = 1568;

/** Файл картинки → base64 JPEG (без префикса data:), не больше MAX_SIDE по длинной стороне. */
export async function compressImage(file: File, maxSide = MAX_SIDE, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    // <img>, а не createImageBitmap: Safari так читает и HEIC, и поворот из EXIF.
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d недоступен");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}
