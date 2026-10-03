import { create as createQr } from "qrcode";
import type { QrErrorCorrection, QrGeometry, Rect } from "./types";

export interface QrMatrix {
  size: number;
  isDark(row: number, col: number): boolean;
}

/** Matriz do QR (mesma implementação no navegador e no servidor). */
export function buildQrMatrix(text: string, errorCorrection: QrErrorCorrection): QrMatrix {
  const qr = createQr(text, { errorCorrectionLevel: errorCorrection });
  const modules = qr.modules;
  return {
    size: modules.size,
    isDark: (row, col) => Boolean(modules.get(row, col)),
  };
}

/**
 * Posicionamento determinístico: cada módulo tem tamanho INTEIRO em pixels
 * (bordas nítidas na impressão). O que sobrar da divisão vira margem extra,
 * centralizada dentro da caixa.
 */
export function computeQrGeometry(box: Rect, moduleCount: number, quietZone: number): QrGeometry {
  const totalModules = moduleCount + quietZone * 2;
  const size = Math.min(box.width, box.height);
  const moduleSize = Math.floor(size / totalModules);
  const drawnSize = moduleSize * totalModules;
  const offsetX = Math.floor((box.width - drawnSize) / 2);
  const offsetY = Math.floor((box.height - drawnSize) / 2);
  return {
    box,
    drawn: { x: box.x + offsetX, y: box.y + offsetY, width: drawnSize, height: drawnSize },
    moduleSize,
    moduleCount,
  };
}

/** SVG vetorial do QR, a partir da mesma matriz usada no PNG. */
export function qrMatrixToSvg(matrix: QrMatrix, quietZone: number, color: string, background: string): string {
  const total = matrix.size + quietZone * 2;
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < matrix.size && matrix.isDark(row, col)) col++;
      parts.push(`M${start + quietZone} ${row + quietZone}h${col - start}v1h${start - col}z`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${background}"/>` +
    `<path fill="${color}" d="${parts.join("")}"/></svg>`
  );
}
