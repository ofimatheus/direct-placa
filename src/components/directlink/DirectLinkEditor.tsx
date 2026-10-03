"use client";

import { useRef, useState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { Icon } from "@/components/ui/icons";
import { UseInPlateDialog, type AppliedPlate } from "@/components/directlab/UseInPlateDialog";
import { platePagePath, type DirectLabRole } from "@/lib/directlab/apply";
import {
  ITEM_TYPE_ORDER,
  ITEM_TYPES,
  MAX_ITEMS,
  directLinkAssetUrl,
  directLinkPublicUrl,
  normalizeItemValue,
  type DirectLinkItemType,
  type PublicItem,
} from "@/lib/directlink/items";
import { PLATE_STATUS_LABEL, RESELLER_STATUS_LABEL } from "@/lib/plates/labels";
import { DirectLinkView } from "./DirectLinkView";
import { ItemIcon } from "./icons";

export interface EditorItem {
  key: string;
  id: string | null;
  type: DirectLinkItemType;
  title: string;
  value: string;
  receiver_name: string;
  is_active: boolean;
}

export interface EditorInitial {
  id: string;
  public_code: string;
  title: string;
  description: string | null;
  banner_path: string | null;
  logo_path: string | null;
  is_active: boolean;
  items: Omit<EditorItem, "key">[];
}

let seq = 0;
const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Criação/edição de DirectLink com prévia de celular. Não usa Google Places
 * nem a cota diária do DirectLab.
 */
export function DirectLinkEditor({ role, initial, supabaseUrl, basePath }: { role: DirectLabRole; initial: EditorInitial | null; supabaseUrl: string; basePath: string }) {
  const [saved, setSaved] = useState<{ id: string; code: string } | null>(initial ? { id: initial.id, code: initial.public_code } : null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [banner, setBanner] = useState<string | null>(initial?.banner_path ?? null);
  const [logo, setLogo] = useState<string | null>(initial?.logo_path ?? null);
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [items, setItems] = useState<EditorItem[]>(() => (initial?.items ?? []).map((i) => ({ ...i, key: newKey() })));
  const [newType, setNewType] = useState<DirectLinkItemType>("instagram");
  const [uploading, setUploading] = useState<"banner" | "logo" | null>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string }>({ busy: false });
  const [picking, setPicking] = useState(false);
  const [applied, setApplied] = useState<AppliedPlate | null>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  const publicUrl = saved ? directLinkPublicUrl(saved.code) : null;
  const statusLabel = role === "admin" ? PLATE_STATUS_LABEL : RESELLER_STATUS_LABEL;

  function patch(key: string, change: Partial<EditorItem>) {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));
  }
  function move(index: number, delta: -1 | 1) {
    setItems((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }
  function addItem() {
    if (items.length >= MAX_ITEMS) return;
    setItems((list) => [...list, { key: newKey(), id: null, type: newType, title: ITEM_TYPES[newType].label, value: "", receiver_name: "", is_active: true }]);
  }

  async function upload(kind: "banner" | "logo", file: File | undefined) {
    if (!file) return;
    setUploading(kind);
    setState({ busy: false });
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    const response = await fetch("/api/directlab/directlinks/upload", { method: "POST", body: form }).catch(() => null);
    const json = response ? ((await response.json().catch(() => ({}))) as { path?: string; error?: string }) : {};
    setUploading(null);
    if (!response?.ok || !json.path) {
      setState({ busy: false, error: json.error ?? "Falha ao enviar a imagem." });
      return;
    }
    if (kind === "banner") setBanner(json.path);
    else setLogo(json.path);
  }

  // Prévia: só botões ativos e com destino válido (como na página pública).
  const previewItems: PublicItem[] = items.flatMap((i) => {
    if (!i.is_active) return [];
    const n = normalizeItemValue(i.type, i.value);
    return n.ok ? [{ type: i.type, title: i.title || ITEM_TYPES[i.type].label, value: n.value, receiver_name: i.receiver_name || null }] : [];
  });
  const invalid = items.map((i) => (i.value.trim() ? normalizeItemValue(i.type, i.value) : null));

  async function save() {
    setState({ busy: true });
    const response = await fetch("/api/directlab/directlinks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: saved?.id ?? null,
        title,
        description: description || null,
        banner_path: banner,
        logo_path: logo,
        is_active: active,
        items: items.map((i) => ({ id: i.id, type: i.type, title: i.title, value: i.value, receiver_name: i.type === "pix" ? i.receiver_name || null : null, is_active: i.is_active })),
      }),
    }).catch(() => null);
    const json = response ? ((await response.json().catch(() => ({}))) as { id?: string; public_code?: string; item_ids?: string[]; error?: string; details?: { message: string }[] }) : {};
    if (!response?.ok || !json.id || !json.public_code) {
      const details = Array.isArray(json.details) ? json.details.map((d) => d.message).join(" ") : "";
      setState({ busy: false, error: [json.error ?? "Falha de conexão. Tente de novo.", details].filter(Boolean).join(" ") });
      return;
    }
    const created = !saved;
    setSaved({ id: json.id, code: json.public_code });
    if (created) window.history.replaceState(null, "", `${basePath}/${json.id}`);
    const ids = json.item_ids ?? [];
    setItems((list) => list.map((item, i) => ({ ...item, id: ids[i] ?? item.id })));
    setState({ busy: false, ok: created ? "DirectLink criado." : "Alterações salvas." });
  }

  const imagePicker = (kind: "banner" | "logo", path: string | null, setPath: (p: string | null) => void, input: React.RefObject<HTMLInputElement | null>) => (
    <div>
      <span className="field-label">{kind === "banner" ? "Banner / fundo" : "Logo (opcional)"}</span>
      <div className={`relative overflow-hidden rounded-lg border border-line bg-paper ${kind === "banner" ? "aspect-[16/9]" : "grid size-24 place-items-center rounded-full"}`}>
        {path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={directLinkAssetUrl(supabaseUrl, path) ?? ""} alt={kind === "banner" ? "Banner" : "Logo"} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 grid place-items-center p-2 text-center text-xs text-ink-soft">{kind === "banner" ? "Padrão azul DirectPlaca" : "Sem logo"}</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn btn-small" disabled={uploading !== null} onClick={() => input.current?.click()}>
          {uploading === kind ? "Enviando..." : path ? "Substituir" : "Enviar imagem"}
        </button>
        {path && (
          <button type="button" className="btn btn-small" onClick={() => setPath(null)}>
            Remover
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        data-upload={kind}
        onChange={(e) => {
          void upload(kind, e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <p className="mt-1 text-xs text-ink-soft">{kind === "banner" ? "PNG, JPG ou WEBP até 4 MB, mínimo 800×400 px." : "PNG, JPG ou WEBP até 1 MB. Quadrada fica melhor."}</p>
    </div>
  );

  return (
    <div className="grid gap-[var(--ds-grid-gap)] xl:grid-cols-[minmax(0,1fr)_380px]" data-directlink-editor="">
      <div className="space-y-[var(--ds-grid-gap)]">
        <section className="card p-5">
          <h2 className="display text-lg">Identidade</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="field-label">Nome da página</span>
              <input className="input" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Adega Monster" data-dl-title="" />
            </label>
            <label className="block sm:col-span-2">
              <span className="field-label">Descrição curta</span>
              <input className="input" maxLength={160} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Bebidas • Conveniência • Delivery" />
            </label>
            {imagePicker("banner", banner, setBanner, bannerInput)}
            {imagePicker("logo", logo, setLogo, logoInput)}
          </div>
        </section>

        <section className="card p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="display text-lg">Botões</h2>
              <p className="text-sm text-ink-soft">
                {items.length} de {MAX_ITEMS}. Use ↑ e ↓ para ordenar.
              </p>
            </div>
            <div className="flex gap-2">
              <select className="input w-auto" value={newType} onChange={(e) => setNewType(e.target.value as DirectLinkItemType)} aria-label="Tipo do novo botão">
                {ITEM_TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {ITEM_TYPES[t].label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={addItem} disabled={items.length >= MAX_ITEMS}>
                <Icon name="plus" className="size-4" /> Adicionar
              </button>
            </div>
          </div>
          <ol className="mt-4 space-y-3" data-dl-editor-items="">
            {items.map((item, index) => {
              const check = invalid[index];
              return (
                <li key={item.key} className={`rounded-xl border p-3 ${item.is_active ? "border-line" : "border-dashed border-line-strong bg-paper"}`} data-dl-editor-item={item.type}>
                  <div className="flex items-center gap-2">
                    <span className="icon-tile size-8" aria-hidden>
                      <ItemIcon type={item.type} className="size-4" />
                    </span>
                    <span className="text-sm font-semibold">{ITEM_TYPES[item.type].label}</span>
                    <span className="ml-auto flex gap-1">
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Subir ${item.title}`}>
                        ↑
                      </button>
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`Descer ${item.title}`}>
                        ↓
                      </button>
                      <button type="button" className="btn btn-small btn-ghost text-danger" onClick={() => setItems((l) => l.filter((i) => i.key !== item.key))} aria-label={`Remover ${item.title}`}>
                        Remover
                      </button>
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="field-label">Título do botão</span>
                      <input className="input" maxLength={60} value={item.title} onChange={(e) => patch(item.key, { title: e.target.value })} />
                    </label>
                    <label className="block">
                      <span className="field-label">{item.type === "pix" ? "Chave PIX" : "Destino"}</span>
                      <input className="input" value={item.value} onChange={(e) => patch(item.key, { value: e.target.value })} placeholder={ITEM_TYPES[item.type].placeholder} aria-invalid={check ? !check.ok : undefined} />
                      <span className={`mt-1 block text-xs ${check && !check.ok ? "font-semibold text-danger" : "text-ink-soft"}`}>{check && !check.ok ? check.error : ITEM_TYPES[item.type].help}</span>
                    </label>
                    {item.type === "pix" && (
                      <label className="block sm:col-span-2">
                        <span className="field-label">Nome do recebedor (opcional)</span>
                        <input className="input" maxLength={60} value={item.receiver_name} onChange={(e) => patch(item.key, { receiver_name: e.target.value })} />
                      </label>
                    )}
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input type="checkbox" checked={item.is_active} onChange={(e) => patch(item.key, { is_active: e.target.checked })} />
                      Botão ativo (visível na página)
                    </label>
                  </div>
                </li>
              );
            })}
          </ol>
          {items.length === 0 && <p className="mt-4 text-sm text-ink-soft">Nenhum botão ainda. Escolha o tipo e clique em Adicionar.</p>}
        </section>

        <section className="card flex flex-wrap items-center gap-3 p-5">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Página ativa (desativada, o link público deixa de abrir)
          </label>
          <button type="button" className="btn btn-primary ml-auto" onClick={save} disabled={state.busy || uploading !== null || !title.trim()} data-dl-save="">
            {state.busy ? "Salvando..." : saved ? "Salvar alterações" : "Criar DirectLink"}
          </button>
          {state.error && (
            <p role="alert" className="w-full rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {state.error}
            </p>
          )}
          {state.ok && !state.error && (
            <p role="status" className="w-full text-sm font-semibold text-ok">
              {state.ok}
            </p>
          )}
        </section>

        {saved && publicUrl && (
          <section className="card p-5" data-dl-published="">
            <h2 className="display text-lg">Link público</h2>
            <p className="mt-1 text-sm text-ink-soft">Permanente: continua o mesmo mesmo se o nome mudar.</p>
            <input className="input mt-3 font-mono text-sm" readOnly value={publicUrl} onFocus={(e) => e.currentTarget.select()} data-dl-url="" />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <CopyButton value={publicUrl} label="Copiar link" copiedLabel="✓ Link copiado" className="btn" />
              <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn">
                Visualizar
              </a>
              <button type="button" className="btn btn-primary" onClick={() => setPicking(true)}>
                Usar em uma placa
              </button>
            </div>
            {applied && (
              <p role="status" className="mt-3 text-sm">
                <strong className="text-ok">Destino da placa {applied.public_code} atualizado.</strong> Situação: {statusLabel[applied.status]}.{" "}
                <a href={platePagePath(role, applied.id)} className="link">
                  Ver placa
                </a>
              </p>
            )}
            <UseInPlateDialog
              open={picking}
              role={role}
              reviewUrl={publicUrl}
              placeName={title}
              destinationType="website"
              destinationLabel="DirectLink"
              purpose={`o DirectLink ${title}`}
              onClose={() => setPicking(false)}
              onApplied={(plate) => {
                setPicking(false);
                setApplied(plate);
              }}
            />
          </section>
        )}
      </div>

      <aside className="xl:sticky xl:top-4 xl:self-start" aria-label="Prévia no celular">
        <p className="field-label">Prévia no celular</p>
        <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-[2rem] border-[6px] border-[#0d1a2a] shadow-xl">
          <div className="h-[640px] overflow-y-auto" data-dl-preview="">
            <DirectLinkView title={title || "Nome da página"} description={description || null} bannerUrl={directLinkAssetUrl(supabaseUrl, banner)} logoUrl={directLinkAssetUrl(supabaseUrl, logo)} items={previewItems} preview />
          </div>
        </div>
        {!active && <p className="mt-2 text-center text-xs font-semibold text-danger">Página desativada: o link público não abre.</p>}
      </aside>
    </div>
  );
}
