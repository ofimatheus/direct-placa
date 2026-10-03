import "server-only";
import { loadImage } from "@napi-rs/canvas";
import { HttpError } from "@/lib/http";
import { readJpegHeader, readPngHeader } from "@/lib/templates/image-validation";

export type BrandingKind = "logo" | "banner" | "landing";
export type BrandingMime = "image/png" | "image/jpeg" | "image/webp";

/**
 * Regras de upload de branding. SVG não é aceito: pode carregar script e
 * seria servido de um bucket público. O tipo é decidido pelos BYTES do
 * arquivo; extensão e Content-Type declarados só precisam concordar.
 */
export const BRANDING_UPLOAD_RULES: Record<
  BrandingKind,
  { maxBytes: number; minWidth: number; minHeight: number; maxDimension: number; label: string }
> = {
  logo: { maxBytes: 1024 * 1024, minWidth: 32, minHeight: 32, maxDimension: 2048, label: "A logo" },
  banner: { maxBytes: 4 * 1024 * 1024, minWidth: 800, minHeight: 400, maxDimension: 6000, label: "O banner" },
  // Imagens da landing (CMS): até 4 MB (abaixo do limite de requisição da Vercel).
  landing: { maxBytes: 4 * 1024 * 1024, minWidth: 64, minHeight: 64, maxDimension: 8000, label: "A imagem" },
};

const EXT: Record<BrandingMime, "png" | "jpg" | "webp"> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function readWebpHeader(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  return null;
}

function sniff(buf: Buffer): { mime: BrandingMime; width: number; height: number; cmyk: boolean } | null {
  const png = readPngHeader(buf);
  if (png) return { mime: "image/png", width: png.width, height: png.height, cmyk: false };
  const jpeg = readJpegHeader(buf);
  if (jpeg) return { mime: "image/jpeg", width: jpeg.width, height: jpeg.height, cmyk: jpeg.jpegComponents === 4 };
  const webp = readWebpHeader(buf);
  if (webp) return { mime: "image/webp", ...webp, cmyk: false };
  return null;
}

function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename);
  return match ? match[1]!.toLowerCase() : "";
}

export interface ValidatedBrandingImage {
  mime: BrandingMime;
  ext: "png" | "jpg" | "webp";
  width: number;
  height: number;
}

export async function validateBrandingImage(
  bytes: Buffer,
  kind: BrandingKind,
  declared: { filename?: string; mime?: string } = {},
): Promise<ValidatedBrandingImage> {
  const rules = BRANDING_UPLOAD_RULES[kind];
  if (bytes.length === 0) throw new HttpError(422, "O arquivo está vazio.");
  if (bytes.length > rules.maxBytes) {
    throw new HttpError(413, `${rules.label} pode ter no máximo ${Math.round(rules.maxBytes / 1024 / 1024)} MB.`);
  }
  const header = sniff(bytes);
  if (!header) throw new HttpError(415, "Envie uma imagem PNG, JPG ou WEBP. SVG e outros formatos não são aceitos.");

  const ext = EXT[header.mime];
  if (declared.mime && declared.mime !== header.mime && !(declared.mime === "image/jpg" && header.mime === "image/jpeg")) {
    throw new HttpError(415, "O tipo do arquivo não corresponde ao conteúdo enviado.");
  }
  if (declared.filename) {
    const fileExt = extensionOf(declared.filename);
    const ok = ext === "jpg" ? fileExt === "jpg" || fileExt === "jpeg" : fileExt === ext;
    if (!ok) throw new HttpError(415, "A extensão do arquivo não corresponde ao conteúdo enviado.");
  }
  if (header.cmyk) throw new HttpError(422, "JPG em CMYK não é suportado. Exporte em RGB ou use PNG/WEBP.");

  const { width, height } = header;
  if (width < rules.minWidth || height < rules.minHeight) {
    throw new HttpError(422, `${rules.label} precisa ter pelo menos ${rules.minWidth}×${rules.minHeight} px.`);
  }
  if (width > rules.maxDimension || height > rules.maxDimension) {
    throw new HttpError(422, `${rules.label} pode ter no máximo ${rules.maxDimension} px de largura ou altura.`);
  }

  try {
    const decoded = await loadImage(bytes);
    if (decoded.width !== width || decoded.height !== height) throw new Error("dimensões divergentes");
  } catch {
    throw new HttpError(422, "Não foi possível ler a imagem: o arquivo pode estar corrompido.");
  }
  return { mime: header.mime, ext, width, height };
}
