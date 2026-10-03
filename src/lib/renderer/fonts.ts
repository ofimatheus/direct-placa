/**
 * Registro fechado de fontes. Os MESMOS arquivos (public/fonts) são usados pelo
 * preview no navegador e pelo renderer de produção no servidor.
 * O valor salvo em plate_template_versions.code_font_family é a chave.
 */
export const PLATE_FONT_KEYS = ["inter-bold", "inter-black", "montserrat-extrabold", "roboto-mono-bold"] as const;
export type PlateFontKey = (typeof PLATE_FONT_KEYS)[number];

export interface PlateFont {
  label: string;
  file: string;
  /** Nome de família registrado nos dois lados (evita depender de fontes do sistema). */
  family: string;
}

export const PLATE_FONTS: Record<PlateFontKey, PlateFont> = {
  "inter-bold": { label: "Inter Bold", file: "inter-bold.ttf", family: "PlateInterBold" },
  "inter-black": { label: "Inter Black", file: "inter-black.ttf", family: "PlateInterBlack" },
  "montserrat-extrabold": {
    label: "Montserrat ExtraBold",
    file: "montserrat-extrabold.ttf",
    family: "PlateMontserratExtraBold",
  },
  "roboto-mono-bold": { label: "Roboto Mono Bold", file: "roboto-mono-bold.ttf", family: "PlateRobotoMonoBold" },
};

export function isPlateFontKey(value: string): value is PlateFontKey {
  return (PLATE_FONT_KEYS as readonly string[]).includes(value);
}

export function fontCss(key: PlateFontKey, sizePx: number): string {
  return `${sizePx}px "${PLATE_FONTS[key].family}"`;
}
