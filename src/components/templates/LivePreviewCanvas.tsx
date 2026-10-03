"use client";

import { useEffect, useRef, useState } from "react";
import { drawPlate } from "@/lib/renderer/draw";
import { ensureBrowserFont } from "@/lib/renderer/browser-fonts";
import type { PlateLayout, Rect, RenderGeometry } from "@/lib/renderer/types";
import { PREVIEW_PUBLIC_CODE, buildQrUrl } from "@/lib/plates/urls";
import { drawGuides } from "@/lib/templates/preview-guides";

export type DragTarget = "qr" | "code";

interface Props {
  imageSrc: string | null;
  layout: PlateLayout | null;
  showGuides: boolean;
  onGeometry(geometry: RenderGeometry | null, error: string | null): void;
  onMove(target: DragTarget, x: number, y: number): void;
}

interface DragState {
  target: DragTarget;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

const contains = (r: Rect, x: number, y: number, pad = 0) =>
  x >= r.x - pad && x <= r.x + r.width + pad && y >= r.y - pad && y <= r.y + r.height + pad;

/**
 * PREVIEW RÁPIDO: usa o MESMO drawPlate do servidor, só que sobre o canvas do
 * navegador. A lógica de desenho não mora aqui — este componente só carrega a
 * imagem/fonte, chama o renderer e trata o arrastar do QR e do código.
 */
export function LivePreviewCanvas({ imageSrc, layout, showGuides, onGeometry, onMove }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<RenderGeometry | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fontVersion, setFontVersion] = useState(0);
  const [hover, setHover] = useState<DragTarget | null>(null);

  useEffect(() => {
    if (!imageSrc) {
      setImage(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.src = imageSrc;
    img
      .decode()
      .then(() => !cancelled && setImage(img))
      .catch(() => !cancelled && onGeometry(null, "Não foi possível carregar a arte no navegador."));
    return () => {
      cancelled = true;
    };
    // onGeometry é estável o suficiente para este efeito; recarregar só quando a imagem muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSrc]);

  const fontKey = layout?.code_font_family;
  useEffect(() => {
    if (!fontKey) return;
    ensureBrowserFont(fontKey).then(() => setFontVersion((v) => v + 1));
  }, [fontKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || !layout) return;
    canvas.width = layout.canvas_width;
    canvas.height = layout.canvas_height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      const geometry = drawPlate(ctx, {
        layout,
        baseImage: image,
        publicCode: PREVIEW_PUBLIC_CODE,
        qrUrl: buildQrUrl(PREVIEW_PUBLIC_CODE),
      });
      if (showGuides) drawGuides(ctx, layout, geometry);
      geometryRef.current = geometry;
      onGeometry(geometry, null);
    } catch (error) {
      geometryRef.current = null;
      onGeometry(null, error instanceof Error ? error.message : "Erro ao desenhar o preview.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, layout, showGuides, fontVersion]);

  function toCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function hitTest(x: number, y: number): DragTarget | null {
    if (!layout) return null;
    if (contains({ x: layout.qr_x, y: layout.qr_y, width: layout.qr_width, height: layout.qr_height }, x, y)) return "qr";
    const text = geometryRef.current?.text;
    if (text && contains(text.box, x, y, layout.code_font_size * 0.3)) return "code";
    return null;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!layout) return;
    const point = toCanvasPoint(event);
    const target = hitTest(point.x, point.y);
    if (!target) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      target,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      originX: target === "qr" ? layout.qr_x : layout.code_x,
      originY: target === "qr" ? layout.qr_y : layout.code_y,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = toCanvasPoint(event);
    const drag = dragRef.current;
    if (!drag || !layout) {
      setHover(hitTest(point.x, point.y));
      return;
    }
    let x = Math.round(drag.originX + point.x - drag.startX);
    let y = Math.round(drag.originY + point.y - drag.startY);
    if (drag.target === "qr") {
      x = Math.min(Math.max(0, x), layout.canvas_width - layout.qr_width);
      y = Math.min(Math.max(0, y), layout.canvas_height - layout.qr_height);
    } else {
      x = Math.min(Math.max(0, x), layout.canvas_width);
      y = Math.min(Math.max(0, y), layout.canvas_height);
    }
    onMove(drag.target, x, y);
  }

  function endDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
    }
  }

  if (!imageSrc || !layout) {
    return (
      <div className="grid aspect-[2/3] w-full max-w-sm place-items-center rounded border border-dashed border-white/40 p-8 text-center text-sm text-white/80">
        Envie a arte base para começar a posicionar o QR e o código.
      </div>
    );
  }

  return (
    <div className="crop-marks inline-block max-w-full">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => !dragRef.current && setHover(null)}
        className="block h-auto max-h-[72vh] w-auto max-w-full touch-none bg-white shadow-[0_1px_0_rgba(0,0,0,0.25)]"
        style={{ cursor: hover || dragRef.current ? "move" : "default" }}
        role="img"
        aria-label={`Preview da placa com o código ${PREVIEW_PUBLIC_CODE}. Arraste o QR ou o código para reposicionar.`}
      />
    </div>
  );
}
