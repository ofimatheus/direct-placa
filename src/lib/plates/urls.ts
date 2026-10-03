import { getGoBaseUrl } from "@/lib/env";

/** Código fictício usado nos previews. Tem 7 caracteres, então nunca colide com um código real (6). */
export const PREVIEW_PUBLIC_CODE = "TESTE01";

export type PlateUrlSource = "qr" | "nfc";

/**
 * URL intermediária da placa. QR e NFC apontam SEMPRE para cá; o destino final
 * (Google, WhatsApp...) é decidido pelo backend a cada acesso.
 *
 * ATENÇÃO: NEXT_PUBLIC_GO_BASE_URL faz parte da identidade física das placas.
 * Depois que placas forem impressas/gravadas, não altere esse valor.
 */
export function buildPlateUrl(publicCode: string, source: PlateUrlSource): string {
  const goBaseUrl = getGoBaseUrl();
  return `${goBaseUrl}/${encodeURIComponent(publicCode)}?src=${source}`;
}

export const buildQrUrl = (publicCode: string) => buildPlateUrl(publicCode, "qr");
export const buildNfcUrl = (publicCode: string) => buildPlateUrl(publicCode, "nfc");
