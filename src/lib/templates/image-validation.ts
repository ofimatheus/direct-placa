import "server-only";
import { loadImage } from "@napi-rs/canvas";
import { limits } from "@/lib/env.server";
import { HttpError } from "@/lib/http";
import { sha256Hex } from "@/lib/utils/hash";
import type { ImageMeta } from "./layout";

/**
 * Validação da arte base no servidor. A ordem importa:
 *   1. tamanho do arquivo
 *   2. tipo REAL pelos bytes (assinatura), não pela extensão nem pelo MIME declarado
 *   3. extensão e MIME declarados precisam bater com o tipo real
 *   4. dimensões lidas do cabeçalho ANTES de decodificar (bloqueia "bombas" de descompressão)
 *   5. particularidades de JPEG que quebrariam a fidelidade (rotação EXIF, CMYK)
 *   6. decodificação completa para garantir que o arquivo é íntegro
 */

interface HeaderInfo {
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  jpegComponents?: number;
  exifOrientation?: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readPngHeader(buf: Buffer): HeaderInfo | null {
  if (buf.length < 33) return null;
  if (!PNG_SIGNATURE.every((byte, i) => buf[i] === byte)) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { mime: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readExifOrientation(buf: Buffer, start: number, end: number): number | undefined {
  // APP1: "Exif\0\0" + cabeçalho TIFF
  if (buf.toString("ascii", start, start + 4) !== "Exif") return undefined;
  const tiff = start + 6;
  if (tiff + 8 > end) return undefined;
  const order = buf.toString("ascii", tiff, tiff + 2);
  const little = order === "II";
  if (!little && order !== "MM") return undefined;
  const u16 = (offset: number) => (little ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset));
  const u32 = (offset: number) => (little ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return undefined;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return undefined;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return undefined;
}

export function readJpegHeader(buf: Buffer): HeaderInfo | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  let exifOrientation: number | undefined;

  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // byte de preenchimento
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // fim/scan antes do SOF
    const length = buf.readUInt16BE(offset + 2);
    const segmentEnd = offset + 2 + length;
    if (length < 2 || segmentEnd > buf.length) return null;

    if (marker === 0xe1 && exifOrientation === undefined) {
      exifOrientation = readExifOrientation(buf, offset + 4, segmentEnd);
    }

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (offset + 10 > buf.length) return null;
      return {
        mime: "image/jpeg",
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
        jpegComponents: buf[offset + 9],
        exifOrientation,
      };
    }
    offset = segmentEnd;
  }
  return null;
}

function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename);
  return match ? match[1]!.toLowerCase() : "";
}

export function extensionMatches(filename: string, mime: string): boolean {
  const ext = extensionOf(filename);
  return mime === "image/png" ? ext === "png" : ext === "jpg" || ext === "jpeg";
}

export function assertUploadRequestAllowed(input: { filename: string; contentType: string; size: number }): "png" | "jpg" {
  if (input.contentType !== "image/png" && input.contentType !== "image/jpeg") {
    throw new HttpError(415, "Envie a arte em PNG ou JPG.");
  }
  if (!extensionMatches(input.filename, input.contentType)) {
    throw new HttpError(415, "A extensão do arquivo não corresponde ao tipo informado.");
  }
  if (input.size > limits.templateMaxUploadBytes) {
    throw new HttpError(413, `A arte pode ter no máximo ${Math.round(limits.templateMaxUploadBytes / 1024 / 1024)} MB.`);
  }
  return input.contentType === "image/png" ? "png" : "jpg";
}

export async function validateTemplateImage(
  bytes: Buffer,
  declared?: { filename?: string; mime?: string },
): Promise<ImageMeta> {
  if (bytes.length === 0) throw new HttpError(422, "O arquivo está vazio.");
  if (bytes.length > limits.templateMaxUploadBytes) {
    throw new HttpError(413, `A arte pode ter no máximo ${Math.round(limits.templateMaxUploadBytes / 1024 / 1024)} MB.`);
  }

  const header = readPngHeader(bytes) ?? readJpegHeader(bytes);
  if (!header) throw new HttpError(415, "O conteúdo do arquivo não é um PNG ou JPG válido.");

  if (declared?.mime && declared.mime !== header.mime) {
    throw new HttpError(415, "O tipo do arquivo não corresponde ao conteúdo enviado.");
  }
  if (declared?.filename && !extensionMatches(declared.filename, header.mime)) {
    throw new HttpError(415, "A extensão do arquivo não corresponde ao conteúdo enviado.");
  }

  const { width, height } = header;
  if (width < 64 || height < 64) throw new HttpError(422, "A arte precisa ter pelo menos 64×64 px.");
  if (width > limits.templateMaxDimension || height > limits.templateMaxDimension) {
    throw new HttpError(422, `A arte pode ter no máximo ${limits.templateMaxDimension} px de largura ou altura.`);
  }
  if (width * height > limits.templateMaxPixels) {
    throw new HttpError(422, `A arte tem pixels demais (${(width * height).toLocaleString("pt-BR")}).`);
  }

  if (header.mime === "image/jpeg") {
    if (header.jpegComponents === 4) {
      throw new HttpError(422, "JPG em CMYK não é suportado. Exporte a arte em RGB (ou use PNG).");
    }
    if (header.exifOrientation !== undefined && header.exifOrientation !== 1) {
      throw new HttpError(
        422,
        "Este JPG tem rotação EXIF, que faria o preview e a arte final saírem diferentes. Exporte novamente sem rotação (ou use PNG).",
      );
    }
  }

  try {
    const decoded = await loadImage(bytes);
    if (decoded.width !== width || decoded.height !== height) {
      throw new Error("dimensões divergentes");
    }
  } catch {
    throw new HttpError(422, "Não foi possível ler a imagem: o arquivo pode estar corrompido.");
  }

  return {
    mime: header.mime,
    ext: header.mime === "image/png" ? "png" : "jpg",
    width,
    height,
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
  };
}
