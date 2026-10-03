import Image from "next/image";

/**
 * Logo oficial DirectPlaca (arquivo em public/brand/directplaca-logo.png).
 * Para trocar a logo, substitua esse arquivo — nenhum código precisa mudar.
 * O fundo da arte é o navy da sidebar (--color-navy), por isso ela só é usada
 * sobre fundo navy.
 */
export const BRAND_LOGO_SRC = "/brand/directplaca-logo.png";
/** Nome do arquivo dentro de public/brand (para quem lê o arquivo no build, ex.: imagem social). */
export const BRAND_LOGO_FILENAME = "directplaca-logo.png";

export function BrandLogo({ className = "h-9 w-auto" }: { className?: string }) {
  return <Image src={BRAND_LOGO_SRC} alt="DirectPlaca" width={250} height={68} priority className={className} />;
}
