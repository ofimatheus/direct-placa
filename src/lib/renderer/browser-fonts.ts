"use client";

import { PLATE_FONTS, type PlateFontKey } from "./fonts";

const loading = new Map<PlateFontKey, Promise<void>>();

/** Carrega no navegador o MESMO arquivo .ttf usado pelo renderer do servidor. */
export function ensureBrowserFont(key: PlateFontKey): Promise<void> {
  const existing = loading.get(key);
  if (existing) return existing;
  const font = PLATE_FONTS[key];
  const promise = new FontFace(font.family, `url(/fonts/${font.file})`)
    .load()
    .then((face) => {
      document.fonts.add(face);
    });
  loading.set(key, promise);
  return promise;
}
