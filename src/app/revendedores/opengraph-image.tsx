import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND_LOGO_FILENAME } from "@/components/shell/BrandLogo";

/** Imagem social da landing (gerada no build). Usa o logo oficial do projeto, sem alterá-lo. */
export const alt = "DirectPlaca | Placas inteligentes para revendedores";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  // Caminho restrito estaticamente a public/brand (o build só inclui essa pasta, não o projeto inteiro).
  const logo = await readFile(join(process.cwd(), "public", "brand", BRAND_LOGO_FILENAME));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  // Inter Bold já presente no projeto (caminho restrito a public/fonts).
  const interBold = await readFile(join(process.cwd(), "public", "fonts", "inter-bold.ttf"));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px", fontFamily: "Inter", background: "linear-gradient(135deg, #0d1a2a 0%, #0d1a2a 55%, #0b3f8f 100%)", color: "#ffffff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} width={250} height={68} alt="" />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, color: "#8fbcff", textTransform: "uppercase" }}>Revenda DirectPlaca</div>
          <div style={{ marginTop: 18, fontSize: 66, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1 }}>Placas inteligentes para revendedores</div>
          <div style={{ marginTop: 22, fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>Compre no atacado. Defina sua margem. Revenda por conta própria.</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Inter", data: interBold, weight: 700, style: "normal" }] },
  );
}
