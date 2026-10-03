import type { StaticImageData } from "next/image";

/**
 * FOTO REAL DA PLACA (opcional).
 *
 * Enquanto for null, a landing mostra uma ILUSTRAÇÃO da placa, identificada
 * como ilustração. Para usar a foto real:
 *   1. salve a imagem em src/app/revendedores/_assets/ (ex.: placa.webp);
 *   2. troque as linhas abaixo por:
 *        import photo from "@/app/revendedores/_assets/placa.webp";
 *        export const productPhoto: StaticImageData | null = photo;
 */
export const productPhoto: StaticImageData | null = null;
