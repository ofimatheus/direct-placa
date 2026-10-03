"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PLATE_FONTS, PLATE_FONT_KEYS, type PlateFontKey } from "@/lib/renderer/fonts";
import type { CodeAlign, PlateLayout, QrErrorCorrection, RenderGeometry } from "@/lib/renderer/types";
import { PREVIEW_PUBLIC_CODE, buildQrUrl } from "@/lib/plates/urls";
import { checkLayout, dpiOf, type LayoutIssue } from "@/lib/templates/geometry";
import { defaultLayoutFor, layoutFromInput } from "@/lib/templates/layout";
import { GUIDE_LEGEND } from "@/lib/templates/preview-guides";
import type { ImageRef, LayoutInput } from "@/lib/templates/schema";
import { formatBytes, keyInput, keySlug } from "@/lib/utils/text";
import { LivePreviewCanvas, type DragTarget } from "./LivePreviewCanvas";

const CLIENT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface EditorImage {
  ref: ImageRef;
  src: string;
  width: number;
  height: number;
  description: string;
}

type Mode =
  | { kind: "create" }
  | {
      kind: "edit";
      templateId: string;
      current: { versionNumber: number; locked: boolean; batchCount: number };
      basedOn?: number;
    };

interface Props {
  mode: Mode;
  initialImage?: EditorImage | null;
  initialLayout?: LayoutInput | null;
}

type AsyncState = { status: "idle" } | { status: "busy"; message?: string } | { status: "error"; message: string } | { status: "done"; message: string };

interface PreviewResult {
  url: string;
  warnings: LayoutIssue[];
}

async function callApi<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    details?: { message: string }[] | unknown;
  } & T;
  if (!response.ok) {
    const details = Array.isArray(body.details) ? body.details.map((d: { message: string }) => d.message).join(" ") : "";
    throw new Error([body.error ?? `Erro ${response.status}`, details].filter(Boolean).join(" "));
  }
  return body;
}

async function readImageSize(file: File): Promise<{ width: number; height: number; src: string }> {
  const src = URL.createObjectURL(file);
  const img = new Image();
  img.src = src;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight, src };
}

export function TemplateEditor({ mode, initialImage = null, initialLayout = null }: Props) {
  const router = useRouter();
  const [meta, setMeta] = useState({ name: "", internal_key: "", description: "", keyTouched: false });
  const [image, setImage] = useState<EditorImage | null>(initialImage);
  const [input, setInput] = useState<LayoutInput | null>(initialLayout);
  const [showGuides, setShowGuides] = useState(true);
  const [geometry, setGeometry] = useState<RenderGeometry | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [upload, setUpload] = useState<AsyncState>({ status: "idle" });
  const [preview, setPreview] = useState<AsyncState>({ status: "idle" });
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [save, setSave] = useState<AsyncState>({ status: "idle" });
  const [dirty, setDirty] = useState(mode.kind === "edit" && mode.basedOn !== undefined);

  const layout: PlateLayout | null = useMemo(
    () => (image && input ? layoutFromInput(input, { width: image.width, height: image.height }) : null),
    [image, input],
  );
  const check = useMemo(() => (layout ? checkLayout(layout, geometry) : { errors: [], warnings: [] }), [layout, geometry]);
  const dpi = layout ? dpiOf(layout) : null;

  const update = useCallback(<K extends keyof LayoutInput>(key: K, value: LayoutInput[K]) => {
    setInput((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
    setPreviewResult(null);
  }, []);

  const handleMove = useCallback((target: DragTarget, x: number, y: number) => {
    setInput((current) =>
      current ? (target === "qr" ? { ...current, qr_x: x, qr_y: y } : { ...current, code_x: x, code_y: y }) : current,
    );
    setDirty(true);
    setPreviewResult(null);
  }, []);

  const handleGeometry = useCallback((g: RenderGeometry | null, error: string | null) => {
    setGeometry(g);
    setDrawError(error);
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setUpload({ status: "error", message: "Envie a arte em PNG ou JPG." });
      return;
    }
    if (file.size > CLIENT_MAX_UPLOAD_BYTES) {
      setUpload({ status: "error", message: `O arquivo tem ${formatBytes(file.size)}; o limite é 25 MB.` });
      return;
    }
    setUpload({ status: "busy", message: "Lendo a arte..." });
    try {
      const size = await readImageSize(file);
      setUpload({ status: "busy", message: "Enviando..." });
      const target = await callApi<{ bucket: string; path: string; token: string }>("/api/admin/templates/uploads", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size }),
      });
      const { error } = await createClient()
        .storage.from(target.bucket)
        .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (error) throw new Error(`Falha no envio: ${error.message}`);

      const sameSize = image && image.width === size.width && image.height === size.height;
      setImage({
        ref: { kind: "staging", path: target.path },
        src: size.src,
        width: size.width,
        height: size.height,
        description: `${file.name}, ${formatBytes(file.size)}`,
      });
      if (!input || !sameSize) setInput(defaultLayoutFor(size.width, size.height));
      setDirty(true);
      setPreviewResult(null);
      setUpload({
        status: "done",
        message:
          input && !sameSize
            ? "Arte enviada. As dimensões mudaram, então o posicionamento foi reiniciado."
            : "Arte enviada. A validação completa acontece ao gerar a prévia ou salvar.",
      });
    } catch (error) {
      setUpload({ status: "error", message: error instanceof Error ? error.message : "Falha no envio." });
    }
  }

  async function handlePreview() {
    if (!image || !input) return;
    setPreview({ status: "busy" });
    try {
      const result = await callApi<PreviewResult>("/api/admin/templates/preview", {
        method: "POST",
        body: JSON.stringify({ image: image.ref, layout: input }),
      });
      setPreviewResult(result);
      setPreview({ status: "idle" });
    } catch (error) {
      setPreview({ status: "error", message: error instanceof Error ? error.message : "Falha na prévia." });
    }
  }

  async function handleSave() {
    if (!image || !input) return;
    setSave({ status: "busy" });
    try {
      if (mode.kind === "create") {
        const result = await callApi<{ templateId: string }>("/api/admin/templates", {
          method: "POST",
          body: JSON.stringify({
            name: meta.name,
            internal_key: meta.internal_key.replace(/-+$/, ""),
            description: meta.description || null,
            image: image.ref,
            layout: input,
          }),
        });
        router.push(`/admin/templates/${result.templateId}`);
        return;
      }
      const result = await callApi<{ versionId: string; versionNumber: number; createdNew: boolean; unchanged: boolean }>(
        `/api/admin/templates/${mode.templateId}/versions`,
        { method: "POST", body: JSON.stringify({ image: image.ref, layout: input }) },
      );
      setImage({ ...image, ref: { kind: "version", versionId: result.versionId } });
      setDirty(false);
      setSave({
        status: "done",
        message: result.unchanged
          ? "Nada mudou em relação à versão atual."
          : result.createdNew
            ? `Versão v${result.versionNumber} criada. Os lotes existentes continuam com a versão anterior.`
            : `Alterações salvas na v${result.versionNumber}.`,
      });
      router.replace(`/admin/templates/${mode.templateId}`);
      router.refresh();
    } catch (error) {
      setSave({ status: "error", message: error instanceof Error ? error.message : "Falha ao salvar." });
    }
  }

  const canSave =
    !!image &&
    !!input &&
    check.errors.length === 0 &&
    !drawError &&
    save.status !== "busy" &&
    upload.status !== "busy" &&
    (mode.kind === "create" ? meta.name.trim().length > 0 && meta.internal_key.length > 0 : dirty);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      <div className="space-y-8">
        {mode.kind === "create" && (
          <Section title="Identificação">
            <TextField
              label="Nome"
              value={meta.name}
              placeholder="Avaliação Google Preto"
              onChange={(name) =>
                setMeta((m) => ({ ...m, name, internal_key: m.keyTouched ? m.internal_key : keySlug(name) }))
              }
            />
            <TextField
              label="Chave interna"
              hint="Identificador estável, sem espaços. Ex.: google-preto"
              value={meta.internal_key}
              onChange={(value) => setMeta((m) => ({ ...m, internal_key: keyInput(value), keyTouched: true }))}
            />
            <TextField
              label="Descrição (opcional)"
              value={meta.description}
              onChange={(description) => setMeta((m) => ({ ...m, description }))}
            />
          </Section>
        )}

        {mode.kind === "edit" && <VersionNotice mode={mode} />}

        <Section title="Arte base">
          <label className="btn w-full cursor-pointer">
            {image ? "Trocar arte" : "Escolher arquivo PNG ou JPG"}
            <input
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              className="sr-only"
              onChange={(e) => {
                void handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {image && (
            <p className="text-sm text-ink-soft">
              {image.width} × {image.height} px, lidos da própria imagem. {image.description}
            </p>
          )}
          <StatusLine state={upload} />
        </Section>

        {input && layout && (
          <>
            <Section title="QR Code">
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="X" suffix="px" value={input.qr_x} onChange={(v) => update("qr_x", v ?? 0)} />
                <NumberField label="Y" suffix="px" value={input.qr_y} onChange={(v) => update("qr_y", v ?? 0)} />
              </div>
              <NumberField
                label="Tamanho (inclui a zona de silêncio)"
                suffix="px"
                value={input.qr_width}
                onChange={(v) => {
                  const size = Math.max(21, v ?? 21);
                  setInput((c) => (c ? { ...c, qr_width: size, qr_height: size } : c));
                  setDirty(true);
                  setPreviewResult(null);
                }}
              />
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label="Correção de erro"
                  value={input.qr_error_correction}
                  options={[
                    ["L", "L (7%)"],
                    ["M", "M (15%)"],
                    ["Q", "Q (25%)"],
                    ["H", "H (30%)"],
                  ]}
                  onChange={(v) => update("qr_error_correction", v as QrErrorCorrection)}
                />
                <NumberField
                  label="Zona de silêncio"
                  suffix="módulos"
                  value={input.qr_quiet_zone}
                  min={0}
                  max={10}
                  onChange={(v) => update("qr_quiet_zone", Math.min(10, Math.max(0, v ?? 0)))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <ColorField label="Cor do QR" value={input.qr_color} onChange={(v) => update("qr_color", v)} />
                <ColorField label="Fundo do QR" value={input.qr_background_color} onChange={(v) => update("qr_background_color", v)} />
              </div>
            </Section>

            <Section title="Código da placa">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={input.show_public_code}
                  onChange={(e) => update("show_public_code", e.target.checked)}
                  className="size-4 accent-mat"
                />
                Imprimir o código na arte
              </label>
              {input.show_public_code && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField label="X (âncora)" suffix="px" value={input.code_x} onChange={(v) => update("code_x", v ?? 0)} />
                    <NumberField label="Y (centro)" suffix="px" value={input.code_y} onChange={(v) => update("code_y", v ?? 0)} />
                  </div>
                  <div>
                    <span className="field-label">Alinhamento</span>
                    <div className="grid grid-cols-3 overflow-hidden rounded-md border border-line-strong" role="radiogroup">
                      {(["left", "center", "right"] as CodeAlign[]).map((align) => (
                        <button
                          key={align}
                          type="button"
                          role="radio"
                          aria-checked={input.code_align === align}
                          onClick={() => update("code_align", align)}
                          className={`py-2 text-sm font-semibold ${input.code_align === align ? "bg-ink text-white" : "bg-surface text-ink-soft"}`}
                        >
                          {align === "left" ? "Esquerda" : align === "center" ? "Centro" : "Direita"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <SelectField
                    label="Fonte"
                    value={input.code_font_family}
                    options={PLATE_FONT_KEYS.map((key) => [key, PLATE_FONTS[key].label])}
                    onChange={(v) => update("code_font_family", v as PlateFontKey)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      label="Tamanho da fonte"
                      suffix="px"
                      value={input.code_font_size}
                      min={6}
                      onChange={(v) => update("code_font_size", Math.max(6, v ?? 6))}
                    />
                    <NumberField
                      label="Largura máxima"
                      suffix="px"
                      nullable
                      value={input.code_max_width}
                      onChange={(v) => update("code_max_width", v && v > 0 ? v : null)}
                    />
                  </div>
                  <ColorField label="Cor do código" value={input.code_color} onChange={(v) => update("code_color", v)} />
                </>
              )}
            </Section>

            <Section title="Impressão">
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Largura"
                  suffix="mm"
                  nullable
                  decimals
                  value={input.print_width_mm}
                  onChange={(v) => update("print_width_mm", v && v > 0 ? v : null)}
                />
                <NumberField
                  label="Altura"
                  suffix="mm"
                  nullable
                  decimals
                  value={input.print_height_mm}
                  onChange={(v) => update("print_height_mm", v && v > 0 ? v : null)}
                />
              </div>
              {dpi !== null && <p className="text-sm text-ink-soft">Resolução resultante: {dpi} DPI.</p>}
              <NumberField
                label="Margem de segurança"
                suffix="px"
                nullable
                value={input.safe_margin}
                onChange={(v) => update("safe_margin", v !== null && v >= 0 ? v : null)}
              />
            </Section>
          </>
        )}
      </div>

      <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <div className="cutting-mat grid min-h-[420px] place-items-center overflow-auto rounded-lg p-8 sm:p-10">
          <LivePreviewCanvas
            imageSrc={image?.src ?? null}
            layout={layout}
            showGuides={showGuides}
            onGeometry={handleGeometry}
            onMove={handleMove}
          />
        </div>

        {layout && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={showGuides}
                  onChange={(e) => setShowGuides(e.target.checked)}
                  className="size-4 accent-mat"
                />
                Mostrar guias
              </label>
              {showGuides &&
                GUIDE_LEGEND.map((item) => (
                  <span key={item.label} className="flex items-center gap-1.5 text-ink-soft">
                    <span className="inline-block h-0.5 w-4" style={{ background: item.color }} aria-hidden />
                    {item.label}
                  </span>
                ))}
            </div>
            <p className="text-sm text-ink-soft">
              Arraste o QR ou o código no preview, ou ajuste pelos campos. O preview usa {PREVIEW_PUBLIC_CODE} e a URL{" "}
              <span className="break-all">{buildQrUrl(PREVIEW_PUBLIC_CODE)}</span>
              {geometry ? `. Cada módulo do QR tem ${geometry.qr.moduleSize} px.` : "."}
            </p>

            <IssueList issues={drawError ? [{ message: drawError }, ...check.errors] : check.errors} tone="danger" />
            <IssueList issues={check.warnings} tone="warn" />

            <div className="flex flex-wrap gap-3 border-t border-line pt-4">
              <button type="button" className="btn" onClick={handlePreview} disabled={preview.status === "busy" || check.errors.length > 0}>
                {preview.status === "busy" ? "Gerando prévia..." : "Gerar prévia fiel"}
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!canSave}>
                {save.status === "busy" ? "Salvando..." : mode.kind === "create" ? "Criar template" : "Salvar alterações"}
              </button>
            </div>
            <StatusLine state={preview} />
            <StatusLine state={save} />
            {dirty && mode.kind === "edit" && save.status !== "busy" && (
              <p className="text-sm text-warn">Há alterações não salvas.</p>
            )}

            {previewResult && (
              <figure className="rounded-lg border border-line bg-surface p-4">
                <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">Prévia fiel, gerada pelo renderer de produção</span>
                  <a href={previewResult.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-cyan hover:underline">
                    Abrir em tamanho real
                  </a>
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewResult.url} alt={`Prévia fiel com o código ${PREVIEW_PUBLIC_CODE}`} className="mx-auto max-h-[60vh] w-auto" />
                <IssueList issues={previewResult.warnings} tone="warn" />
              </figure>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function VersionNotice({ mode }: { mode: Extract<Mode, { kind: "edit" }> }) {
  const { current, basedOn } = mode;
  return (
    <div className="rounded-md border border-line bg-surface p-4 text-sm">
      {basedOn !== undefined && (
        <p className="mb-2 font-semibold">Layout carregado da v{basedOn}. Salve para torná-lo a versão atual.</p>
      )}
      {current.locked ? (
        <p>
          A v{current.versionNumber} já foi usada em {current.batchCount} {current.batchCount === 1 ? "lote" : "lotes"} e está bloqueada.
          Ao salvar, será criada a v{current.versionNumber + 1}; os lotes existentes continuam com a v{current.versionNumber}.
        </p>
      ) : (
        <p>A v{current.versionNumber} ainda não foi usada em nenhum lote, então as alterações são salvas nela mesma.</p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="display border-b border-line pb-2 text-base">{title}</h2>
      {children}
    </section>
  );
}

function StatusLine({ state }: { state: AsyncState }) {
  if (state.status === "idle") return null;
  if (state.status === "busy") return state.message ? <p className="text-sm text-ink-soft">{state.message}</p> : null;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={`text-sm ${state.status === "error" ? "text-danger" : "text-ok"}`}>
      {state.message}
    </p>
  );
}

function IssueList({ issues, tone }: { issues: LayoutIssue[]; tone: "danger" | "warn" }) {
  if (issues.length === 0) return null;
  return (
    <ul className={`space-y-1 border-l-2 pl-3 text-sm ${tone === "danger" ? "border-danger text-danger" : "border-warn text-warn"}`}>
      {issues.map((issue, i) => (
        <li key={`${issue.message}-${i}`}>{issue.message}</li>
      ))}
    </ul>
  );
}

function TextField(props: { label: string; value: string; onChange(v: string): void; placeholder?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="field-label">{props.label}</span>
      <input className="input" value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      {props.hint && <span className="mt-1 block text-xs text-ink-soft">{props.hint}</span>}
    </label>
  );
}

function NumberField(props: {
  label: string;
  value: number | null;
  onChange(v: number | null): void;
  suffix?: string;
  min?: number;
  max?: number;
  nullable?: boolean;
  decimals?: boolean;
}) {
  return (
    <label className="block">
      <span className="field-label">{props.label}</span>
      <span className="flex items-center rounded-md border border-line-strong bg-surface focus-within:outline-2 focus-within:outline-cyan">
        <input
          type="number"
          inputMode={props.decimals ? "decimal" : "numeric"}
          step={props.decimals ? "0.1" : "1"}
          min={props.min}
          max={props.max}
          className="min-h-10 w-full min-w-0 bg-transparent px-2.5 outline-none"
          value={props.value ?? ""}
          placeholder={props.nullable ? "Opcional" : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return props.onChange(props.nullable ? null : 0);
            const parsed = props.decimals ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
            if (Number.isFinite(parsed)) props.onChange(props.decimals ? Math.round(parsed * 100) / 100 : parsed);
          }}
        />
        {props.suffix && <span className="pr-2.5 text-xs text-ink-soft">{props.suffix}</span>}
      </span>
    </label>
  );
}

function SelectField(props: { label: string; value: string; options: [string, string][]; onChange(v: string): void }) {
  return (
    <label className="block">
      <span className="field-label">{props.label}</span>
      <select className="input" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorField(props: { label: string; value: string; onChange(v: string): void }) {
  return (
    <label className="block">
      <span className="field-label">{props.label}</span>
      <span className="flex items-center gap-2 rounded-md border border-line-strong bg-surface px-2">
        <input
          type="color"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value.toUpperCase())}
          className="h-8 w-8 cursor-pointer border-0 bg-transparent p-0"
        />
        <span className="text-sm">{props.value.toUpperCase()}</span>
      </span>
    </label>
  );
}
