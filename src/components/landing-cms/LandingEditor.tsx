"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveContact, landingMediaUrl, whatsappUrl } from "@/lib/landing/contact";
import {
  ALL_SECTIONS,
  BUILTIN_IMAGES,
  PRODUCTS_MAX,
  LANDING_ICONS,
  MIDDLE_SECTIONS,
  SECTION_LABEL,
  SOCIAL_NETWORKS,
  validateLandingContent,
  type BuiltinImage,
  type Cta,
  type IconItem,
  type ImageRef,
  type LandingContent,
  type MiddleSection,
  type SectionId,
} from "@/lib/landing/schema";
import { formatCents, parseMoneyToCents } from "@/lib/reseller-sales";

/* ===================================================================== */
/* Tipos                                                                  */
/* ===================================================================== */

export interface LandingMedia {
  id: string;
  path: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export interface LandingEditorProps {
  installed: boolean;
  initialContent: LandingContent;
  initialVersion: number;
  published: LandingContent | null;
  publishedAt: string | null;
  publicUrl: string;
  mediaBase: string;
  media: LandingMedia[];
  /** URL das capturas que vêm com o projeto (miniaturas). */
  builtinThumbs: Record<BuiltinImage, string>;
}

type Tab = "conteudo" | "comercial" | "midia" | "seo";
type Update = (fn: (c: LandingContent) => void) => void;
interface Confirm {
  title: string;
  text: string;
  action: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

const ICON_LABEL: Record<string, string> = {
  box: "Caixa",
  dashboard: "Painel",
  tag: "Etiqueta",
  qr: "QR Code",
  nfc: "NFC",
  plate: "Placa",
  settings: "Ajustes",
  link: "Link",
  layers: "Camadas",
  revenue: "Dinheiro",
  lab: "Laboratório",
  star: "Estrela",
  customers: "Pessoas",
  chart: "Gráfico",
  lock: "Cadeado",
  help: "Ajuda",
  store: "Loja",
  accesses: "Acessos",
};
const BUILTIN_LABEL: Record<BuiltinImage, string> = {
  "tela-dashboard": "Tela: Dashboard",
  "tela-placas": "Tela: Minhas placas",
  "tela-clientes": "Tela: Clientes",
  "tela-directlab": "Tela: DirectLab",
  "tela-avaliacao-google": "Tela: Avaliação Google",
  "tela-directlink-publico": "Tela: DirectLink (celular)",
};
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.slice(0, 40);
const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso)).replace(", ", " às ") : "—";

/* ===================================================================== */
/* Campos                                                                 */
/* ===================================================================== */

function Field({ label, hint, children, count }: { label: string; hint?: string; children: React.ReactNode; count?: { value: string; max: number } }) {
  return (
    <label className="block min-w-0">
      <span className="field-label flex items-baseline justify-between gap-2">
        <span>{label}</span>
        {count && <span className={`text-xs font-normal tabular-nums ${count.value.length > count.max ? "text-danger" : "text-ink-soft"}`}>{count.value.length}/{count.max}</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

function TextInput({ label, value, onChange, max, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; max: number; hint?: string; placeholder?: string }) {
  return (
    <Field label={label} hint={hint} count={{ value, max }}>
      <input className="input mt-1 w-full" value={value} maxLength={max + 50} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function TextArea({ label, value, onChange, max, rows = 3, hint }: { label: string; value: string; onChange: (v: string) => void; max: number; rows?: number; hint?: string }) {
  return (
    <Field label={label} hint={hint} count={{ value, max }}>
      <textarea className="input mt-1 w-full py-2" rows={rows} value={value} maxLength={max + 100} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function Toggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold select-none">
      <input type="checkbox" className="size-4 accent-[var(--color-mat)]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      {label}
    </label>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Field label={label}>
      <select className="input mt-1 w-full" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Valor em reais → centavos inteiros (sem float). Vazio = sem preço (null). */
function MoneyInput({ label, cents, onChange, emptyLabel }: { label: string; cents: number | null; onChange: (v: number | null) => void; emptyLabel: string }) {
  const [text, setText] = useState(cents === null ? "" : formatCents(cents).replace(/^R\$\s?/, ""));
  const [error, setError] = useState(false);
  useEffect(() => {
    setText(cents === null ? "" : formatCents(cents).replace(/^R\$\s?/, ""));
  }, [cents]);
  return (
    <Field label={label} hint={error ? "Valor inválido. Use, por exemplo, 12,90." : `Vazio = "${emptyLabel}".`}>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-sm text-ink-soft">R$</span>
        <input
          className={`input w-full tabular-nums ${error ? "border-danger" : ""}`}
          inputMode="decimal"
          placeholder={emptyLabel}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(false);
          }}
          onBlur={() => {
            if (!text.trim()) return onChange(null);
            const parsed = parseMoneyToCents(text);
            if (parsed === null) setError(true);
            else onChange(parsed);
          }}
        />
      </div>
    </Field>
  );
}

function CtaEditor({ label, value, onChange }: { label: string; value: Cta; onChange: (v: Cta) => void }) {
  return (
    <fieldset className="min-w-0 rounded-xl border border-line p-3">
      <legend className="px-1 text-xs font-bold tracking-wide text-ink-soft uppercase">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput label="Texto do botão" value={value.label} max={60} onChange={(v) => onChange({ ...value, label: v })} />
        <Select
          label="Destino"
          value={value.action}
          options={[
            { value: "contact", label: "Contato configurado (aba Comercial)" },
            { value: "whatsapp", label: "WhatsApp" },
            { value: "section", label: "Uma seção da página" },
            { value: "url", label: "Link (https://)" },
          ]}
          onChange={(action) => onChange({ ...value, action, section: action === "section" ? (value.section ?? "wholesale") : undefined, url: action === "url" ? (value.url ?? "") : undefined })}
        />
        {value.action === "section" && (
          <Select label="Seção" value={value.section ?? "wholesale"} options={ALL_SECTIONS.map((s) => ({ value: s, label: SECTION_LABEL[s] }))} onChange={(section) => onChange({ ...value, section })} />
        )}
        {value.action === "url" && <TextInput label="Endereço" value={value.url ?? ""} max={500} placeholder="https://" onChange={(url) => onChange({ ...value, url })} />}
      </div>
    </fieldset>
  );
}

function OptionalCta({ label, value, onChange, fallbackLabel }: { label: string; value: Cta | null; onChange: (v: Cta | null) => void; fallbackLabel: string }) {
  return (
    <div className="grid gap-2">
      <Toggle label={`Mostrar ${label.toLowerCase()}`} checked={value !== null} onChange={(on) => onChange(on ? { label: fallbackLabel, action: "contact" } : null)} />
      {value && <CtaEditor label={label} value={value} onChange={onChange} />}
    </div>
  );
}

/* ===================================================================== */
/* Listas (adicionar, reordenar, ocultar, excluir)                         */
/* ===================================================================== */

function ListEditor<T extends { id?: string; enabled?: boolean }>({
  title,
  items,
  max,
  min = 0,
  onChange,
  create,
  render,
  itemLabel,
  askConfirm,
  addLabel = "+ Adicionar",
  limitMessage,
}: {
  title: string;
  items: T[];
  max: number;
  min?: number;
  addLabel?: string;
  /** Texto discreto exibido quando o limite é atingido. */
  limitMessage?: string;
  onChange: (items: T[]) => void;
  create: () => T;
  render: (item: T, set: (item: T) => void, index: number) => React.ReactNode;
  itemLabel: (item: T, index: number) => string;
  askConfirm: (c: Confirm) => void;
}) {
  const move = (i: number, d: number) => {
    const next = [...items];
    const [it] = next.splice(i, 1);
    next.splice(i + d, 0, it!);
    onChange(next);
  };
  return (
    <div className="grid gap-3" data-list={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold">
          {title} <span className="font-normal text-ink-soft">({items.length}/{max})</span>
        </p>
        <button type="button" className="btn btn-small" disabled={items.length >= max} onClick={() => onChange([...items, create()])}>
          {addLabel}
        </button>
      </div>
      {limitMessage && items.length >= max && (
        <p className="text-xs text-ink-soft" role="status" data-list-limit="">
          {limitMessage}
        </p>
      )}
      {items.map((item, i) => (
        <div key={item.id ?? i} className={`min-w-0 rounded-xl border p-3 ${item.enabled === false ? "border-dashed border-line bg-paper/60" : "border-line"}`} data-list-item="">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold">
              {i + 1}. {itemLabel(item, i) || "Sem título"}
              {item.enabled === false && <span className="badge badge-gray ml-2">Oculto</span>}
            </p>
            <div className="flex items-center gap-1">
              {item.enabled !== undefined && (
                <button type="button" className="btn btn-small" onClick={() => onChange(items.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))}>
                  {item.enabled ? "Ocultar" : "Exibir"}
                </button>
              )}
              <button type="button" className="btn btn-small" aria-label="Mover para cima" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="btn btn-small" aria-label="Mover para baixo" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="btn btn-small text-danger"
                disabled={items.length <= min}
                onClick={() =>
                  askConfirm({
                    title: "Excluir item?",
                    text: `"${itemLabel(item, i) || "Item"}" será removido do rascunho. Para só esconder, use "Ocultar".`,
                    action: "Excluir",
                    danger: true,
                    onConfirm: () => onChange(items.filter((_, j) => j !== i)),
                  })
                }
              >
                Excluir
              </button>
            </div>
          </div>
          {render(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))), i)}
        </div>
      ))}
    </div>
  );
}

function StringList({ title, items, max, onChange, itemMax, askConfirm }: { title: string; items: string[]; max: number; onChange: (v: string[]) => void; itemMax: number; askConfirm: (c: Confirm) => void }) {
  const wrapped = items.map((value, i) => ({ id: `s${i}`, value }));
  return (
    <ListEditor
      title={title}
      items={wrapped}
      max={max}
      askConfirm={askConfirm}
      onChange={(list) => onChange(list.map((x) => x.value))}
      create={() => ({ id: `s${items.length}`, value: "Novo item" })}
      itemLabel={(x) => x.value}
      render={(x, set) => <TextInput label="Texto" value={x.value} max={itemMax} onChange={(v) => set({ ...x, value: v })} />}
    />
  );
}

function IconItems({ title, items, max, min, onChange, askConfirm }: { title: string; items: IconItem[]; max: number; min?: number; onChange: (v: IconItem[]) => void; askConfirm: (c: Confirm) => void }) {
  return (
    <ListEditor
      title={title}
      items={items}
      max={max}
      min={min}
      askConfirm={askConfirm}
      onChange={onChange}
      create={() => ({ id: newId("item"), icon: "star" as const, title: "Novo item", text: "", enabled: true })}
      itemLabel={(x) => x.title}
      render={(x, set) => (
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Select label="Ícone" value={x.icon} options={LANDING_ICONS.map((v) => ({ value: v, label: ICON_LABEL[v] ?? v }))} onChange={(icon) => set({ ...x, icon })} />
          <TextInput label="Título" value={x.title} max={80} onChange={(v) => set({ ...x, title: v })} />
          <div className="sm:col-span-2">
            <TextArea label="Descrição" value={x.text} max={300} rows={2} onChange={(v) => set({ ...x, text: v })} />
          </div>
        </div>
      )}
    />
  );
}

/* ===================================================================== */
/* Imagens                                                                */
/* ===================================================================== */

function ImagePicker({
  label,
  value,
  onChange,
  media,
  mediaBase,
  thumbs,
  nullable,
  noneLabel = "Sem imagem",
  askConfirm,
}: {
  label: string;
  value: ImageRef | null;
  onChange: (v: ImageRef | null) => void;
  media: LandingMedia[];
  mediaBase: string;
  thumbs: Record<BuiltinImage, string>;
  nullable: boolean;
  noneLabel?: string;
  askConfirm: (c: Confirm) => void;
}) {
  const current = value ? (value.kind === "builtin" ? `b:${value.key}` : `m:${value.mediaId}`) : "";
  const src = value ? (value.kind === "builtin" ? thumbs[value.key] : landingMediaUrl(mediaBase, value.path)) : null;
  const choose = (key: string) => {
    if (!key) {
      if (value)
        askConfirm({ title: "Remover imagem?", text: "A imagem deixa de aparecer nesta parte da página (o arquivo continua na biblioteca).", action: "Remover", danger: true, onConfirm: () => onChange(null) });
      return;
    }
    const alt = value?.alt ?? "";
    if (key.startsWith("b:")) onChange({ kind: "builtin", key: key.slice(2) as BuiltinImage, alt: alt || BUILTIN_LABEL[key.slice(2) as BuiltinImage].replace("Tela: ", "") });
    else {
      const m = media.find((x) => x.id === key.slice(2));
      if (m) onChange({ kind: "media", mediaId: m.id, path: m.path, width: m.width, height: m.height, alt });
    }
  };
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]" data-image-picker={label}>
      <div className="grid aspect-[4/3] w-32 place-items-center overflow-hidden rounded-lg border border-line bg-paper">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="px-2 text-center text-xs text-ink-soft">{nullable ? noneLabel : "—"}</span>}
      </div>
      <div className="grid min-w-0 gap-2">
        <Field label={label}>
          <select className="input mt-1 w-full" value={current} onChange={(e) => choose(e.target.value)}>
            {nullable && <option value="">{noneLabel}</option>}
            <optgroup label="Imagens do projeto">
              {BUILTIN_IMAGES.map((k) => (
                <option key={k} value={`b:${k}`}>
                  {BUILTIN_LABEL[k]}
                </option>
              ))}
            </optgroup>
            {media.length > 0 && (
              <optgroup label="Enviadas (aba Mídia)">
                {media.map((m) => (
                  <option key={m.id} value={`m:${m.id}`}>
                    {m.path.slice(6, 14)}… ({m.width}×{m.height})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        {value && <TextInput label="Texto alternativo (acessibilidade)" value={value.alt} max={200} onChange={(alt) => onChange({ ...value, alt })} />}
      </div>
    </div>
  );
}

/* ===================================================================== */
/* Editor                                                                 */
/* ===================================================================== */

export function LandingEditor(props: LandingEditorProps) {
  const router = useRouter();
  const [content, setContent] = useState<LandingContent>(props.initialContent);
  const [version, setVersion] = useState(props.initialVersion);
  const [saved, setSaved] = useState(JSON.stringify(props.initialContent));
  const [published, setPublished] = useState<string | null>(props.published ? JSON.stringify(props.published) : null);
  const [publishedAt, setPublishedAt] = useState(props.publishedAt);
  const [media, setMedia] = useState(props.media);
  const [tab, setTab] = useState<Tab>("conteudo");
  const [busy, setBusy] = useState<null | "save" | "publish" | "discard" | "upload">(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; errors?: { path: string; message: string }[] } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const json = useMemo(() => JSON.stringify(content), [content]);
  /** Há edições ainda não salvas. */
  const edited = json !== saved;
  // Nunca salvo (versão 0): o conteúdo padrão pode ser salvo/publicado como está.
  const dirty = edited || version === 0;
  const unpublished = dirty || saved !== published;
  const contact = resolveContact(content.contact);

  const update: Update = (fn) =>
    setContent((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });

  async function api(method: string, url: string, body?: unknown) {
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, data };
  }

  async function save(): Promise<number | null> {
    const check = validateLandingContent(content);
    if (!check.ok) {
      setFeedback({ ok: false, text: "Corrija os campos abaixo antes de salvar.", errors: check.errors });
      return null;
    }
    setBusy("save");
    try {
      const { res, data } = await api("PUT", "/api/admin/landing/draft", { content, expectedVersion: version });
      if (!res.ok) {
        setFeedback({ ok: false, text: String(data.error ?? "Não foi possível salvar o rascunho."), errors: data.errors as never });
        return null;
      }
      setVersion(Number(data.version));
      setSaved(json);
      setFeedback({ ok: true, text: "✓ Rascunho salvo. A página pública só muda ao publicar." });
      return Number(data.version);
    } catch {
      setFeedback({ ok: false, text: "Sem conexão com o servidor. Tente novamente." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    let v = version;
    if (dirty) {
      const savedVersion = await save();
      if (savedVersion === null) return;
      v = savedVersion;
    }
    setBusy("publish");
    try {
      const { res, data } = await api("POST", "/api/admin/landing/publish", { expectedVersion: v });
      if (!res.ok) {
        setFeedback({ ok: false, text: String(data.error ?? "Não foi possível publicar. A versão pública anterior continua no ar."), errors: data.errors as never });
        return;
      }
      setPublished(json);
      setPublishedAt(String(data.publishedAt));
      setFeedback({ ok: true, text: "✓ Landing publicada com sucesso." });
      router.refresh();
    } catch {
      setFeedback({ ok: false, text: "Sem conexão com o servidor. A versão pública anterior continua no ar." });
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setBusy("discard");
    try {
      const { res, data } = await api("POST", "/api/admin/landing/discard");
      if (!res.ok) return setFeedback({ ok: false, text: String(data.error ?? "Não foi possível descartar.") });
      setFeedback({ ok: true, text: "Rascunho descartado. Recarregando…" });
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setFeedback({ ok: false, text: "Envie uma imagem PNG, JPG ou WEBP. SVG e outros formatos não são aceitos." });
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setFeedback({ ok: false, text: "A imagem pode ter no máximo 4 MB." });
      return;
    }
    setBusy("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/landing/media", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return setFeedback({ ok: false, text: String(data.error ?? "Não foi possível enviar a imagem.") });
      setMedia((m) => [data as unknown as LandingMedia, ...m]);
      setFeedback({ ok: true, text: "✓ Imagem enviada. Escolha-a no campo de imagem da seção desejada." });
    } catch {
      setFeedback({ ok: false, text: "Sem conexão com o servidor." });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeMedia(m: LandingMedia) {
    const { res, data } = await api("DELETE", `/api/admin/landing/media/${m.id}`);
    if (!res.ok) return setFeedback({ ok: false, text: String(data.error ?? "Não foi possível excluir a imagem.") });
    setMedia((list) => list.filter((x) => x.id !== m.id));
    setFeedback({ ok: true, text: "Imagem excluída." });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(props.publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFeedback({ ok: false, text: "Não foi possível copiar. Selecione o endereço e copie manualmente." });
    }
  }

  const pickerProps = { media, mediaBase: props.mediaBase, thumbs: props.builtinThumbs, askConfirm: setConfirm };
  const moveSection = (id: MiddleSection, d: number) =>
    update((c) => {
      const i = c.order.indexOf(id);
      const j = i + d;
      if (j < 0 || j >= c.order.length) return;
      [c.order[i], c.order[j]] = [c.order[j]!, c.order[i]!];
    });

  const status = !props.installed
    ? { badge: "badge-amber", text: "CMS não instalado" }
    : publishedAt === null
      ? { badge: "badge-amber", text: "Usando o conteúdo padrão (nada publicado ainda)" }
      : unpublished
        ? { badge: "badge-amber", text: "Alterações não publicadas" }
        : { badge: "badge-green", text: "● Publicada" };

  /* ----------------------------- seções ----------------------------- */

  const head = (s: "howItWorks" | "product" | "products" | "platform" | "directlab" | "why" | "about" | "faq" | "finalCta" | "wholesale" | "subscription", withText = true) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextInput label="Pequeno destaque (eyebrow)" value={content[s].eyebrow} max={60} onChange={(v) => update((c) => void (c[s].eyebrow = v))} />
      <TextInput label="Título" value={content[s].title} max={160} onChange={(v) => update((c) => void (c[s].title = v))} />
      {withText && (
        <div className="sm:col-span-2">
          <TextArea label="Texto" value={content[s].text} max={600} onChange={(v) => update((c) => void (c[s].text = v))} />
        </div>
      )}
    </div>
  );

  const editors: Record<SectionId, () => React.ReactNode> = {
    hero: () => (
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Pequeno destaque (eyebrow)" value={content.hero.eyebrow} max={60} onChange={(v) => update((c) => void (c.hero.eyebrow = v))} />
          <TextInput label="Título principal" value={content.hero.title} max={140} onChange={(v) => update((c) => void (c.hero.title = v))} />
          <TextInput label="Segunda linha do título (em azul)" value={content.hero.titleHighlight} max={140} onChange={(v) => update((c) => void (c.hero.titleHighlight = v))} />
          <div className="sm:col-span-2">
            <TextArea label="Texto" value={content.hero.text} max={600} onChange={(v) => update((c) => void (c.hero.text = v))} />
          </div>
        </div>
        <CtaEditor label="Botão principal" value={content.hero.primaryCta} onChange={(v) => update((c) => void (c.hero.primaryCta = v))} />
        <OptionalCta label="Botão secundário" value={content.hero.secondaryCta} fallbackLabel="Conhecer a DirectPlaca" onChange={(v) => update((c) => void (c.hero.secondaryCta = v))} />
        <StringList title="Benefícios abaixo dos botões" items={content.hero.bullets} max={4} itemMax={60} askConfirm={setConfirm} onChange={(v) => update((c) => void (c.hero.bullets = v))} />
        <ImagePicker label="Imagem principal" value={content.hero.image} nullable noneLabel="Sem imagem (texto ocupa a largura)" {...pickerProps} onChange={(v) => update((c) => void (c.hero.image = v))} />
        <Toggle label="Mostrar a placa sobre a imagem" checked={content.hero.showPlate} onChange={(v) => update((c) => void (c.hero.showPlate = v))} />
      </div>
    ),
    howItWorks: () => (
      <div className="grid gap-4">
        {head("howItWorks")}
        <IconItems title="Passos" items={content.howItWorks.steps} max={6} min={1} askConfirm={setConfirm} onChange={(v) => update((c) => void (c.howItWorks.steps = v))} />
      </div>
    ),
    product: () => (
      <div className="grid gap-4">
        {head("product")}
        <ImagePicker label="Imagem/foto da placa" value={content.product.image} nullable noneLabel="Ilustração padrão" {...pickerProps} onChange={(v) => update((c) => void (c.product.image = v))} />
        <TextInput label="Legenda da imagem" value={content.product.imageCaption} max={160} onChange={(v) => update((c) => void (c.product.imageCaption = v))} />
        <IconItems title="Benefícios" items={content.product.features} max={8} askConfirm={setConfirm} onChange={(v) => update((c) => void (c.product.features = v))} />
        <OptionalCta label="Botão" value={content.product.cta} fallbackLabel="Quero ser revendedor" onChange={(v) => update((c) => void (c.product.cta = v))} />
      </div>
    ),
    products: () => (
      <div className="grid gap-4">
        <p className="text-sm text-ink-soft">
          Carrossel de modelos de placas. Só aparece na landing quando houver produto ativo com imagem. Rótulo, título e descrição são opcionais.
        </p>
        {head("products")}
        <ListEditor
          title="Produtos"
          items={content.products.items}
          max={PRODUCTS_MAX}
          addLabel="+ Adicionar produto"
          limitMessage={`Limite de ${PRODUCTS_MAX} produtos atingido. Exclua ou reaproveite um produto para incluir outro.`}
          askConfirm={setConfirm}
          onChange={(v) => update((c) => void (c.products.items = v))}
          create={() => ({ id: newId("produto"), image: null, title: "", text: "", enabled: true })}
          itemLabel={(x) => x.title || x.image?.alt || (x.image ? "Produto sem título" : "Produto sem imagem")}
          render={(x, set) => (
            <div className="grid gap-3">
              <ImagePicker label="Imagem da placa" value={x.image} nullable noneLabel="Escolha uma imagem" {...pickerProps} onChange={(image) => set({ ...x, image })} />
              {!x.image && <p className="text-xs text-danger">Sem imagem, este produto não aparece na landing.</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput label="Título (opcional)" value={x.title} max={80} onChange={(v) => set({ ...x, title: v })} />
                <TextInput label="Descrição curta (opcional)" value={x.text} max={200} onChange={(v) => set({ ...x, text: v })} />
              </div>
            </div>
          )}
        />
      </div>
    ),
    platform: () => (
      <div className="grid gap-4">
        {head("platform")}
        <ListEditor
          title="Telas"
          items={content.platform.screenshots}
          max={6}
          askConfirm={setConfirm}
          onChange={(v) => update((c) => void (c.platform.screenshots = v))}
          create={() => ({ id: newId("tela"), image: { kind: "builtin" as const, key: "tela-dashboard" as const, alt: "Tela da plataforma" }, caption: "", enabled: true })}
          itemLabel={(x) => x.caption || x.image.alt}
          render={(x, set) => (
            <div className="grid gap-3">
              <ImagePicker label="Imagem" value={x.image} nullable={false} {...pickerProps} onChange={(v) => v && set({ ...x, image: v })} />
              <TextInput label="Legenda" value={x.caption} max={160} onChange={(v) => set({ ...x, caption: v })} />
            </div>
          )}
        />
        <TextInput label="Observação abaixo das telas" value={content.platform.note} max={200} onChange={(v) => update((c) => void (c.platform.note = v))} />
        <OptionalCta label="Botão" value={content.platform.cta} fallbackLabel="Quero ser revendedor" onChange={(v) => update((c) => void (c.platform.cta = v))} />
      </div>
    ),
    directlab: () => (
      <div className="grid gap-4">
        {head("directlab")}
        <ListEditor
          title="Ferramentas"
          items={content.directlab.tools}
          max={6}
          askConfirm={setConfirm}
          onChange={(v) => update((c) => void (c.directlab.tools = v))}
          create={() => ({ id: newId("ferramenta"), icon: "lab" as const, title: "Nova ferramenta", text: "", image: null, imageStyle: "screen" as const, cta: null, enabled: true })}
          itemLabel={(x) => x.title}
          render={(x, set) => (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <Select label="Ícone" value={x.icon} options={LANDING_ICONS.map((v) => ({ value: v, label: ICON_LABEL[v] ?? v }))} onChange={(icon) => set({ ...x, icon })} />
                <TextInput label="Título" value={x.title} max={60} onChange={(v) => set({ ...x, title: v })} />
              </div>
              <TextArea label="Descrição" value={x.text} max={300} rows={2} onChange={(v) => set({ ...x, text: v })} />
              <ImagePicker label="Imagem" value={x.image} nullable {...pickerProps} onChange={(v) => set({ ...x, image: v })} />
              <Select
                label="Moldura da imagem"
                value={x.imageStyle}
                options={[
                  { value: "screen", label: "Tela de computador" },
                  { value: "phone", label: "Celular" },
                ]}
                onChange={(imageStyle) => set({ ...x, imageStyle })}
              />
              <OptionalCta label="Botão" value={x.cta} fallbackLabel="Saiba mais" onChange={(cta) => set({ ...x, cta })} />
            </div>
          )}
        />
        <ImagePicker label="Imagem do hub do DirectLab" value={content.directlab.hubImage} nullable {...pickerProps} onChange={(v) => update((c) => void (c.directlab.hubImage = v))} />
        <TextInput label="Legenda do hub" value={content.directlab.hubCaption} max={200} onChange={(v) => update((c) => void (c.directlab.hubCaption = v))} />
      </div>
    ),
    wholesale: () => <p className="text-sm text-ink-soft">O conteúdo do Atacado fica na aba Comercial.</p>,
    subscription: () => <p className="text-sm text-ink-soft">O conteúdo da Mensalidade fica na aba Comercial.</p>,
    why: () => (
      <div className="grid gap-4">
        {head("why")}
        <IconItems title="Benefícios" items={content.why.items} max={9} min={1} askConfirm={setConfirm} onChange={(v) => update((c) => void (c.why.items = v))} />
      </div>
    ),
    about: () => (
      <div className="grid gap-4">
        {head("about")}
        <ImagePicker label="Imagem (opcional)" value={content.about.image} nullable {...pickerProps} onChange={(v) => update((c) => void (c.about.image = v))} />
      </div>
    ),
    faq: () => (
      <div className="grid gap-4">
        {head("faq")}
        <ListEditor
          title="Perguntas"
          items={content.faq.items}
          max={40}
          askConfirm={setConfirm}
          onChange={(v) => update((c) => void (c.faq.items = v))}
          create={() => ({ id: newId("faq"), q: "Nova pergunta?", a: "Resposta.", enabled: true })}
          itemLabel={(x) => x.q}
          render={(x, set) => (
            <div className="grid gap-3">
              <TextInput label="Pergunta" value={x.q} max={160} onChange={(v) => set({ ...x, q: v })} />
              <TextArea label="Resposta" value={x.a} max={1200} rows={3} onChange={(v) => set({ ...x, a: v })} />
            </div>
          )}
        />
      </div>
    ),
    finalCta: () => (
      <div className="grid gap-4">
        {head("finalCta")}
        <CtaEditor label="Botão principal" value={content.finalCta.primaryCta} onChange={(v) => update((c) => void (c.finalCta.primaryCta = v))} />
        <OptionalCta label="Botão secundário" value={content.finalCta.secondaryCta} fallbackLabel="Falar no WhatsApp" onChange={(v) => update((c) => void (c.finalCta.secondaryCta = v))} />
      </div>
    ),
  };

  const sectionCard = (id: SectionId, opts: { movable?: boolean; index?: number; fixedNote?: string }) => {
    const canHide = id !== "hero";
    const enabled = id === "hero" ? true : (content[id] as { enabled: boolean }).enabled;
    return (
      <details key={id} className="card overflow-hidden" data-section-card={id}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4">
          <span className="flex min-w-0 items-center gap-3">
            <span className="text-base font-bold">{SECTION_LABEL[id]}</span>
            {!enabled && <span className="badge badge-gray">Oculta</span>}
            {opts.fixedNote && <span className="text-xs text-ink-soft">{opts.fixedNote}</span>}
          </span>
          <span className="flex items-center gap-2" onClick={(e) => e.preventDefault()}>
            {canHide && <Toggle label="Exibir esta seção" checked={enabled} testId={`toggle-${id}`} onChange={(v) => update((c) => void ((c[id as Exclude<SectionId, "hero">] as { enabled: boolean }).enabled = v))} />}
            {opts.movable && (
              <>
                <button type="button" className="btn btn-small" aria-label={`Subir ${SECTION_LABEL[id]}`} disabled={opts.index === 0} onClick={() => moveSection(id as MiddleSection, -1)}>
                  ↑
                </button>
                <button type="button" className="btn btn-small" aria-label={`Descer ${SECTION_LABEL[id]}`} disabled={opts.index === MIDDLE_SECTIONS.length - 1} onClick={() => moveSection(id as MiddleSection, 1)}>
                  ↓
                </button>
              </>
            )}
          </span>
        </summary>
        <div className="border-t border-line px-5 py-5">{editors[id]()}</div>
      </details>
    );
  };

  /* ----------------------------- abas ----------------------------- */

  const tabs: { key: Tab; label: string }[] = [
    { key: "conteudo", label: "Conteúdo" },
    { key: "comercial", label: "Comercial" },
    { key: "midia", label: "Mídia" },
    { key: "seo", label: "SEO e site" },
  ];

  return (
    <div className="grid gap-[var(--ds-section-gap)]" data-landing-editor="">
      {!props.installed && (
        <p className="rounded-lg border border-line bg-paper px-4 py-3 text-sm" role="status">
          O CMS da landing ainda não está no banco: aplique a migration <code className="font-mono">20261008120000_landing_cms.sql</code>. Até lá, /revendedores mostra o conteúdo padrão e nada pode ser salvo.
        </p>
      )}

      {/* Barra de status e ações */}
      <section className="card sticky top-[calc(var(--ds-topbar-h)+0.5rem)] z-20 flex flex-wrap items-center justify-between gap-4 px-5 py-4" aria-label="Publicação" data-landing-status="">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`badge ${status.badge}`} data-status-text="">
              {status.text}
            </span>
            {edited && <span className="text-xs font-semibold text-danger">Há edições não salvas</span>}
          </p>
          <p className="mt-1 text-xs text-ink-soft">Última publicação: {fmtDate(publishedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" disabled={!props.installed || !dirty || busy !== null} onClick={save} data-action="save">
            {busy === "save" ? "Salvando…" : "Salvar rascunho"}
          </button>
          {edited ? (
            <span className="btn cursor-not-allowed opacity-50" aria-disabled="true" title="Salve o rascunho para pré-visualizar" data-action="preview">
              Pré-visualizar
            </span>
          ) : (
            <a className="btn" href="/preview/revendedores" target="_blank" rel="noopener" data-action="preview">
              Pré-visualizar
            </a>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!props.installed || !unpublished || busy !== null}
            data-action="publish"
            onClick={() =>
              setConfirm({
                title: "Publicar alterações?",
                text: `O conteúdo do rascunho${edited ? " (as edições atuais serão salvas antes)" : ""} passa a aparecer em /revendedores para todos os visitantes.`,
                action: "Publicar",
                onConfirm: publish,
              })
            }
          >
            {busy === "publish" ? "Publicando…" : "Publicar alterações"}
          </button>
        </div>
      </section>

      {feedback && (
        <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${feedback.ok ? "border-ok/30 bg-ok-soft" : "border-danger/25 bg-danger-soft"}`} data-landing-feedback={feedback.ok ? "ok" : "error"}>
          <p className="font-semibold">{feedback.text}</p>
          {feedback.errors && feedback.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {feedback.errors.map((e) => (
                <li key={`${e.path}-${e.message}`}>
                  <code className="font-mono">{e.path}</code>: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Link público */}
      <section className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4" aria-label="Landing publicada" data-landing-public="">
        <div className="min-w-0">
          <p className="text-sm font-bold">Landing publicada</p>
          <p className="truncate font-mono text-sm text-ink-soft" data-public-url="">
            {props.publicUrl}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className="btn" href={props.publicUrl} target="_blank" rel="noopener noreferrer">
            Abrir página
          </a>
          <button type="button" className="btn" onClick={copyLink} data-action="copy">
            {copied ? "Link copiado" : "Copiar link"}
          </button>
        </div>
      </section>

      <nav className="flex max-w-full flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" aria-label="Áreas da landing" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`segmented-item rounded-lg font-semibold ${tab === t.key ? "bg-mat text-white" : "text-ink-soft hover:bg-paper"}`} onClick={() => setTab(t.key)} data-tab={t.key}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "conteudo" && (
        <div className="grid gap-3" role="tabpanel">
          <p className="text-sm text-ink-soft">O Hero fica sempre no topo e o CTA final no fim. As demais seções podem ser reordenadas (↑ ↓) ou ocultadas.</p>
          {sectionCard("hero", { fixedNote: "sempre no topo" })}
          {content.order.map((id, i) => sectionCard(id, { movable: true, index: i }))}
          {sectionCard("finalCta", { fixedNote: "sempre no fim" })}
        </div>
      )}

      {tab === "comercial" && (
        <div className="grid gap-4" role="tabpanel">
          <section className="card grid gap-4 px-5 py-5" data-commercial="wholesale">
            <h2 className="display text-lg">Atacado</h2>
            {head("wholesale")}
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Destaque ao lado do título" value={content.wholesale.badge} max={80} onChange={(v) => update((c) => void (c.wholesale.badge = v))} />
              <TextInput label='Texto quando não há preço ("Sob consulta")' value={content.wholesale.priceOnRequest} max={40} onChange={(v) => update((c) => void (c.wholesale.priceOnRequest = v))} />
              <TextInput label="Explicação abaixo do 'Sob consulta'" value={content.wholesale.priceOnRequestHint} max={120} onChange={(v) => update((c) => void (c.wholesale.priceOnRequestHint = v))} />
              <TextInput label="Observação abaixo dos lotes" value={content.wholesale.note} max={300} onChange={(v) => update((c) => void (c.wholesale.note = v))} />
            </div>
            <ListEditor
              title="Lotes / condições"
              items={content.wholesale.tiers}
              max={6}
              min={1}
              askConfirm={setConfirm}
              onChange={(v) => update((c) => void (c.wholesale.tiers = v))}
              create={() => ({ id: newId("lote"), label: "Novo lote", quantity: 10, unitPriceCents: null, unitLabel: "por unidade", description: "", badge: "", highlight: false, custom: false, customTitle: "", ctaLabel: "Escolher meu lote", enabled: true })}
              itemLabel={(x) => x.label}
              render={(x, set) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput label="Nome do lote" value={x.label} max={40} onChange={(v) => set({ ...x, label: v })} />
                  <Field label="Quantidade mínima">
                    <input className="input mt-1 w-full tabular-nums" type="number" min={1} max={1000000} value={x.quantity} onChange={(e) => set({ ...x, quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                  </Field>
                  <Toggle label="Condição personalizada (sem preço; ex.: 100+)" checked={x.custom} onChange={(v) => set({ ...x, custom: v, customTitle: v && !x.customTitle ? "Condição personalizada" : x.customTitle })} />
                  <Toggle label="Destacar este lote" checked={x.highlight} onChange={(v) => set({ ...x, highlight: v })} />
                  {x.custom ? (
                    <TextInput label="Título da condição" value={x.customTitle} max={60} onChange={(v) => set({ ...x, customTitle: v })} />
                  ) : (
                    <>
                      <MoneyInput label="Preço por unidade" cents={x.unitPriceCents} emptyLabel={content.wholesale.priceOnRequest} onChange={(v) => set({ ...x, unitPriceCents: v })} />
                      <TextInput label="Unidade" value={x.unitLabel} max={30} onChange={(v) => set({ ...x, unitLabel: v })} />
                    </>
                  )}
                  <TextInput label="Texto auxiliar" value={x.description} max={200} onChange={(v) => set({ ...x, description: v })} />
                  <TextInput label="Selo (opcional)" value={x.badge} max={30} onChange={(v) => set({ ...x, badge: v })} />
                  <TextInput label="Texto do botão" value={x.ctaLabel} max={40} onChange={(v) => set({ ...x, ctaLabel: v })} />
                </div>
              )}
            />
          </section>

          <section className="card grid gap-4 px-5 py-5" data-commercial="subscription">
            <h2 className="display text-lg">Mensalidade da plataforma</h2>
            {head("subscription")}
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Nome do plano" value={content.subscription.planName} max={60} onChange={(v) => update((c) => void (c.subscription.planName = v))} />
              <MoneyInput label="Valor mensal" cents={content.subscription.monthlyPriceCents} emptyLabel={content.subscription.priceNullTitle} onChange={(v) => update((c) => void (c.subscription.monthlyPriceCents = v))} />
              <TextInput label='Texto após o valor ("/mês")' value={content.subscription.periodLabel} max={20} onChange={(v) => update((c) => void (c.subscription.periodLabel = v))} />
              <TextInput label="Título quando não há valor" value={content.subscription.priceNullTitle} max={60} onChange={(v) => update((c) => void (c.subscription.priceNullTitle = v))} />
              <TextInput label="Texto quando não há valor" value={content.subscription.priceNullText} max={160} onChange={(v) => update((c) => void (c.subscription.priceNullText = v))} />
              <TextInput label="Título da lista do que a mensalidade cobre" value={content.subscription.coversTitle} max={80} onChange={(v) => update((c) => void (c.subscription.coversTitle = v))} />
              <div className="sm:col-span-2">
                <TextArea label="Nota de transparência" value={content.subscription.transparency} max={300} rows={2} onChange={(v) => update((c) => void (c.subscription.transparency = v))} />
              </div>
              <TextInput label="Texto do botão" value={content.subscription.ctaLabel} max={40} onChange={(v) => update((c) => void (c.subscription.ctaLabel = v))} />
            </div>
            <fieldset className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-3">
              <legend className="px-1 text-xs font-bold tracking-wide text-ink-soft uppercase">Primeiro período incluso</legend>
              <div className="sm:col-span-3">
                <Toggle label="Mostrar o primeiro período incluso" checked={content.subscription.firstPeriod.enabled} testId="first-period" onChange={(v) => update((c) => void (c.subscription.firstPeriod.enabled = v))} />
              </div>
              {content.subscription.firstPeriod.enabled && (
                <>
                  <Field label="Quantidade">
                    <input className="input mt-1 w-full tabular-nums" type="number" min={1} max={365} value={content.subscription.firstPeriod.amount} onChange={(e) => update((c) => void (c.subscription.firstPeriod.amount = Math.min(365, Math.max(1, Math.floor(Number(e.target.value) || 1)))))} />
                  </Field>
                  <Select
                    label="Unidade"
                    value={content.subscription.firstPeriod.unit}
                    options={[
                      { value: "dias", label: "dias" },
                      { value: "meses", label: "meses" },
                    ]}
                    onChange={(u) => update((c) => void (c.subscription.firstPeriod.unit = u))}
                  />
                  <div className="flex items-end">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => update((c) => void (c.subscription.firstPeriod.text = `Primeiros ${c.subscription.firstPeriod.amount} ${c.subscription.firstPeriod.unit} inclusos na primeira compra.`))}
                    >
                      Gerar texto
                    </button>
                  </div>
                  <div className="sm:col-span-3">
                    <TextInput label="Texto exibido" value={content.subscription.firstPeriod.text} max={160} onChange={(v) => update((c) => void (c.subscription.firstPeriod.text = v))} />
                  </div>
                </>
              )}
            </fieldset>
            <StringList title="O que a mensalidade cobre" items={content.subscription.covers} max={10} itemMax={60} askConfirm={setConfirm} onChange={(v) => update((c) => void (c.subscription.covers = v))} />
            <StringList title="Itens do plano" items={content.subscription.features} max={14} itemMax={60} askConfirm={setConfirm} onChange={(v) => update((c) => void (c.subscription.features = v))} />
          </section>

          <section className="card grid gap-4 px-5 py-5" data-commercial="contact">
            <h2 className="display text-lg">Contato</h2>
            <p className="rounded-lg border border-line bg-paper px-4 py-3 text-sm" data-contact-in-use={contact.channel}>
              <strong>Botões de contato em uso:</strong> {contact.description}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="WhatsApp (só números, com DDI e DDD)" value={content.contact.whatsappNumber} max={15} placeholder="5511999998888" onChange={(v) => update((c) => void (c.contact.whatsappNumber = v.replace(/\D/g, "")))} />
              <Select
                label="Canal preferido"
                value={content.contact.preferred}
                options={[
                  { value: "auto", label: "Automático (WhatsApp → formulário → e-mail)" },
                  { value: "whatsapp", label: "WhatsApp" },
                  { value: "form", label: "Formulário" },
                  { value: "email", label: "E-mail" },
                ]}
                onChange={(v) => update((c) => void (c.contact.preferred = v))}
              />
              <div className="sm:col-span-2">
                <TextArea label="Mensagem padrão do WhatsApp" value={content.contact.whatsappMessage} max={300} rows={2} onChange={(v) => update((c) => void (c.contact.whatsappMessage = v))} />
              </div>
              <TextInput label="E-mail" value={content.contact.email} max={120} onChange={(v) => update((c) => void (c.contact.email = v))} />
              <TextInput label="Formulário externo (https://)" value={content.contact.formUrl} max={500} onChange={(v) => update((c) => void (c.contact.formUrl = v))} />
            </div>
            {whatsappUrl(content.contact.whatsappNumber, content.contact.whatsappMessage) && (
              <p className="text-xs break-all text-ink-soft" data-whatsapp-url="">
                Link gerado:{" "}
                <a className="text-mat underline" href={whatsappUrl(content.contact.whatsappNumber, content.contact.whatsappMessage)!} target="_blank" rel="noopener noreferrer">
                  {whatsappUrl(content.contact.whatsappNumber, content.contact.whatsappMessage)}
                </a>
              </p>
            )}
          </section>
        </div>
      )}

      {tab === "midia" && (
        <section className="card grid gap-4 px-5 py-5" role="tabpanel" data-media-tab="">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="display text-lg">Biblioteca de imagens</h2>
              <p className="text-sm text-ink-soft">PNG, JPG ou WEBP até 4 MB. SVG não é aceito. Depois de enviar, escolha a imagem no campo da seção desejada.</p>
            </div>
            <label className={`btn btn-primary ${busy === "upload" || !props.installed ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
              {busy === "upload" ? "Enviando…" : "Enviar imagem"}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} data-media-input="" />
            </label>
          </div>
          {media.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhuma imagem enviada ainda.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {media.map((m) => (
                <li key={m.id} className="min-w-0 overflow-hidden rounded-xl border border-line" data-media-item={m.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={landingMediaUrl(props.mediaBase, m.path)} alt="" className="aspect-video w-full bg-paper object-contain" />
                  <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="truncate text-ink-soft">
                      {m.width}×{m.height} · {Math.round(m.bytes / 1024)} KB
                    </span>
                    <button
                      type="button"
                      className="btn btn-small text-danger"
                      onClick={() =>
                        setConfirm({
                          title: "Excluir imagem da biblioteca?",
                          text: "O arquivo será apagado. Se a imagem estiver em uso no rascunho ou na landing publicada, a exclusão será recusada.",
                          action: "Excluir",
                          danger: true,
                          onConfirm: () => removeMedia(m),
                        })
                      }
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div>
            <p className="text-sm font-bold">Imagens do projeto</p>
            <p className="text-xs text-ink-soft">Capturas reais da plataforma (dados de demonstração). Podem ser trocadas pelas suas imagens em cada seção.</p>
            <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {BUILTIN_IMAGES.map((k) => (
                <li key={k} className="overflow-hidden rounded-lg border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={props.builtinThumbs[k]} alt="" className="aspect-video w-full object-cover" />
                  <p className="truncate px-2 py-1 text-[0.7rem] text-ink-soft">{BUILTIN_LABEL[k]}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {tab === "seo" && (
        <div className="grid gap-4" role="tabpanel">
          <section className="card grid gap-3 px-5 py-5 sm:grid-cols-2" data-seo="">
            <h2 className="display text-lg sm:col-span-2">SEO</h2>
            <TextInput label="Título SEO" value={content.seo.title} max={70} hint="Vazio = título padrão." onChange={(v) => update((c) => void (c.seo.title = v))} />
            <TextInput label="Domínio do site (https://…)" value={content.seo.siteUrl} max={500} hint="Vazio = domínio de produção da Vercel." onChange={(v) => update((c) => void (c.seo.siteUrl = v.trim()))} />
            <div className="sm:col-span-2">
              <TextArea label="Meta description" value={content.seo.description} max={200} rows={2} hint="Vazio = texto do Hero. Buscadores costumam mostrar ~160 caracteres." onChange={(v) => update((c) => void (c.seo.description = v))} />
            </div>
            <TextInput label="Título para redes sociais (Open Graph)" value={content.seo.ogTitle} max={90} hint="Vazio = título SEO." onChange={(v) => update((c) => void (c.seo.ogTitle = v))} />
            <TextInput label="Descrição para redes sociais" value={content.seo.ogDescription} max={200} hint="Vazio = meta description." onChange={(v) => update((c) => void (c.seo.ogDescription = v))} />
            <div className="sm:col-span-2">
              <ImagePicker label="Imagem social" value={content.seo.ogImage} nullable noneLabel="Imagem padrão gerada" {...pickerProps} onChange={(v) => update((c) => void (c.seo.ogImage = v))} />
            </div>
            <Toggle label="Permitir indexação pelos buscadores" checked={content.seo.index} onChange={(v) => update((c) => void (c.seo.index = v))} />
          </section>

          <section className="card grid gap-4 px-5 py-5" data-menu="">
            <h2 className="display text-lg">Menu do cabeçalho</h2>
            <p className="text-sm text-ink-soft">A logo é sempre a oficial da DirectPlaca. Itens que apontam para uma seção oculta não aparecem.</p>
            <ListEditor
              title="Itens do menu"
              items={content.nav}
              max={8}
              askConfirm={setConfirm}
              onChange={(v) => update((c) => void (c.nav = v))}
              create={() => ({ id: newId("nav"), label: "Novo item", section: "faq" as const, enabled: true })}
              itemLabel={(x) => x.label}
              render={(x, set) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput label="Nome" value={x.label} max={30} onChange={(v) => set({ ...x, label: v })} />
                  <Select label="Seção de destino" value={x.section} options={ALL_SECTIONS.map((s) => ({ value: s, label: SECTION_LABEL[s] }))} onChange={(section) => set({ ...x, section })} />
                </div>
              )}
            />
            <Toggle label="Mostrar botão no cabeçalho" checked={content.headerCta.enabled} onChange={(v) => update((c) => void (c.headerCta.enabled = v))} />
            {content.headerCta.enabled && <CtaEditor label="Botão do cabeçalho" value={content.headerCta.cta} onChange={(v) => update((c) => void (c.headerCta.cta = v))} />}
          </section>

          <section className="card grid gap-4 px-5 py-5" data-footer="">
            <h2 className="display text-lg">Rodapé</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Copyright" value={content.footer.copyright} max={120} hint="{ano} vira o ano atual." onChange={(v) => update((c) => void (c.footer.copyright = v))} />
              <TextInput label="Texto institucional" value={content.footer.text} max={300} onChange={(v) => update((c) => void (c.footer.text = v))} />
            </div>
            <ListEditor
              title="Links"
              items={content.footer.links}
              max={8}
              askConfirm={setConfirm}
              onChange={(v) => update((c) => void (c.footer.links = v))}
              create={() => ({ id: newId("link"), label: "Novo link", url: "https://", enabled: true })}
              itemLabel={(x) => x.label}
              render={(x, set) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput label="Nome" value={x.label} max={40} onChange={(v) => set({ ...x, label: v })} />
                  <TextInput label="Destino (https://, /caminho ou #âncora)" value={x.url} max={500} onChange={(v) => set({ ...x, url: v })} />
                </div>
              )}
            />
            <ListEditor
              title="Redes sociais"
              items={content.footer.socials}
              max={8}
              askConfirm={setConfirm}
              onChange={(v) => update((c) => void (c.footer.socials = v))}
              create={() => ({ id: newId("rede"), network: "instagram" as const, url: "https://", enabled: true })}
              itemLabel={(x) => x.network}
              render={(x, set) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select label="Rede" value={x.network} options={SOCIAL_NETWORKS.map((n) => ({ value: n, label: n }))} onChange={(network) => set({ ...x, network })} />
                  <TextInput label="Endereço (https://)" value={x.url} max={500} onChange={(v) => set({ ...x, url: v })} />
                </div>
              )}
            />
          </section>

          <section className="card flex flex-wrap items-center justify-between gap-3 px-5 py-5">
            <div>
              <h2 className="display text-lg">Descartar rascunho</h2>
              <p className="text-sm text-ink-soft">Volta o rascunho ao conteúdo publicado (ou ao conteúdo padrão, se nada foi publicado).</p>
            </div>
            <button
              type="button"
              className="btn text-danger"
              disabled={!props.installed || busy !== null}
              onClick={() => setConfirm({ title: "Descartar o rascunho?", text: "Todas as alterações não publicadas serão perdidas.", action: "Descartar", danger: true, onConfirm: discard })}
              data-action="discard"
            >
              Descartar rascunho
            </button>
          </section>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy/60 p-4" role="presentation" onClick={() => setConfirm(null)}>
          <div className="card w-full max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="landing-confirm-title" onClick={(e) => e.stopPropagation()} data-confirm="">
            <h2 id="landing-confirm-title" className="display text-lg">
              {confirm.title}
            </h2>
            <p className="mt-2 text-sm text-ink-soft">{confirm.text}</p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn" onClick={() => setConfirm(null)} autoFocus>
                Cancelar
              </button>
              <button
                type="button"
                className={`btn ${confirm.danger ? "bg-danger text-white" : "btn-primary"}`}
                data-confirm-action=""
                onClick={async () => {
                  const c = confirm;
                  setConfirm(null);
                  await c.onConfirm();
                }}
              >
                {confirm.action}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
