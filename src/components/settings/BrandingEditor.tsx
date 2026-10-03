"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/login/BrandMark";
import { LoginScreen } from "@/components/login/LoginScreen";
import { ConfirmDialog } from "@/components/ui/Modal";
import { BRANDING_LIMITS, DEFAULT_BRANDING, resolveBranding, type BrandingRow } from "@/lib/branding/defaults";

interface Props {
  initial: BrandingRow | null;
  supabaseUrl: string;
  /** false quando a migration de branding ainda não foi aplicada. */
  available: boolean;
}

type Draft = {
  brand_name: string;
  show_brand_name: boolean;
  eyebrow: string;
  title: string;
  subtitle: string;
  logo_path: string | null;
  banner_path: string | null;
};

const fromRow = (row: BrandingRow | null): Draft => ({
  brand_name: row?.brand_name ?? DEFAULT_BRANDING.brandName,
  show_brand_name: row?.show_brand_name ?? true,
  eyebrow: row?.eyebrow ?? DEFAULT_BRANDING.eyebrow,
  title: row?.title ?? DEFAULT_BRANDING.title,
  subtitle: row?.subtitle ?? DEFAULT_BRANDING.subtitle,
  logo_path: row?.logo_path ?? null,
  banner_path: row?.banner_path ?? null,
});

/** Texto igual ao padrão é gravado como nulo: continua acompanhando o padrão. */
const orNull = (value: string, fallback: string) => (value.trim() && value.trim() !== fallback ? value.trim() : null);

/** Miniatura da tela de login real (1440×900) redimensionada para a largura disponível. */
function ScaledPreview({ draft, supabaseUrl }: { draft: Draft; supabaseUrl: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / 1440);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const branding = resolveBranding(draft, supabaseUrl);
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-lg border border-line" style={{ height: 900 * scale }} data-branding-preview="">
      <div className="pointer-events-none absolute top-0 left-0 origin-top-left" style={{ width: 1440, height: 900, transform: `scale(${scale})` }} inert>
        <div className="h-[900px] overflow-hidden [&_main]:min-h-[900px] [&_main>div:last-child]:min-h-[900px]">
          <LoginScreen branding={branding} />
        </div>
      </div>
    </div>
  );
}

export function BrandingEditor({ initial, supabaseUrl, available }: Props) {
  const router = useRouter();
  const saved = useMemo(() => fromRow(initial), [initial]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [fullPreview, setFullPreview] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "banner" | null>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string }>({ busy: false });
  const logoInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const preview = resolveBranding(draft, supabaseUrl);

  useEffect(() => {
    if (!fullPreview) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setFullPreview(false);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [fullPreview]);

  async function upload(kind: "logo" | "banner", file: File | undefined) {
    if (!file) return;
    setUploading(kind);
    setState({ busy: false });
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    const response = await fetch("/api/admin/branding/upload", { method: "POST", body: form }).catch(() => null);
    const json = response ? ((await response.json().catch(() => ({}))) as { path?: string; error?: string }) : {};
    setUploading(null);
    if (!response?.ok || !json.path) {
      setState({ busy: false, error: json.error ?? "Falha de conexão. Tente de novo." });
      return;
    }
    setDraft((d) => ({ ...d, [kind === "logo" ? "logo_path" : "banner_path"]: json.path! }));
    setState({ busy: false, ok: `${kind === "logo" ? "Logo enviada" : "Banner enviado"}. Confira a prévia e salve para publicar.` });
  }

  async function save() {
    setState({ busy: true });
    const response = await fetch("/api/admin/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand_name: orNull(draft.brand_name, DEFAULT_BRANDING.brandName),
        show_brand_name: draft.show_brand_name,
        eyebrow: orNull(draft.eyebrow, DEFAULT_BRANDING.eyebrow),
        title: orNull(draft.title, DEFAULT_BRANDING.title),
        subtitle: orNull(draft.subtitle, DEFAULT_BRANDING.subtitle),
        logo_path: draft.logo_path,
        banner_path: draft.banner_path,
      }),
    }).catch(() => null);
    const json = response ? ((await response.json().catch(() => ({}))) as { error?: string; details?: { message: string }[] }) : {};
    if (!response?.ok) {
      const details = Array.isArray(json.details) ? json.details.map((d) => d.message).join(" ") : "";
      setState({ busy: false, error: [json.error ?? "Falha de conexão. Tente de novo.", details].filter(Boolean).join(" ") });
      return;
    }
    setState({ busy: false, ok: "Tela de login atualizada. A mudança já vale para o próximo acesso." });
    router.refresh();
  }

  async function reset() {
    setState({ busy: true });
    const response = await fetch("/api/admin/branding/reset", { method: "POST" }).catch(() => null);
    const json = response ? ((await response.json().catch(() => ({}))) as { error?: string }) : {};
    if (!response?.ok) {
      setState({ busy: false, error: json.error ?? "Falha de conexão. Tente de novo." });
      return;
    }
    setConfirmReset(false);
    setDraft(fromRow(null));
    setState({ busy: false, ok: "Padrão DirectPlaca restaurado." });
    router.refresh();
  }

  if (!available) {
    return (
      <p className="rounded-md border border-warn/40 bg-surface px-4 py-3 text-sm">
        A personalização ainda não está disponível neste banco: aplique a migration <code>20260930120100_login_branding.sql</code>.
        Enquanto isso, a tela de login usa o padrão DirectPlaca.
      </p>
    );
  }

  const field = (key: "brand_name" | "eyebrow" | "title", label: string, max: number) => (
    <label className="block">
      <span className="field-label">{label}</span>
      <input className="input" maxLength={max} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  );

  return (
    <div className="space-y-5" data-branding-editor="">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-4">
          {field("brand_name", "Nome da marca", BRANDING_LIMITS.brandName)}
          <fieldset>
            <legend className="field-label">Topo do card</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="show_brand_name" checked={draft.show_brand_name} onChange={() => setDraft({ ...draft, show_brand_name: true })} />
                Mostrar logo + nome
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="show_brand_name" checked={!draft.show_brand_name} onChange={() => setDraft({ ...draft, show_brand_name: false })} />
                Mostrar somente logo
              </label>
            </div>
          </fieldset>
          {field("eyebrow", "Texto de acesso", BRANDING_LIMITS.eyebrow)}
          {field("title", "Título", BRANDING_LIMITS.title)}
          <label className="block">
            <span className="field-label">Subtítulo</span>
            <textarea className="input min-h-20" maxLength={BRANDING_LIMITS.subtitle} value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="field-label">Logo do card</span>
              <div className="grid h-24 place-items-center rounded-md border border-line bg-[#070b14] p-3">
                {preview.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.logoUrl} alt="Logo enviada" className="max-h-full max-w-full object-contain" />
                ) : (
                  <BrandMark variant="tile" className="size-14" />
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn btn-small" disabled={uploading !== null} onClick={() => logoInput.current?.click()}>
                  {uploading === "logo" ? "Enviando..." : draft.logo_path ? "Substituir logo" : "Enviar logo"}
                </button>
                {draft.logo_path && (
                  <button type="button" className="btn btn-small" onClick={() => setDraft({ ...draft, logo_path: null })}>
                    Usar logo padrão
                  </button>
                )}
              </div>
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                data-upload="logo"
                onChange={(e) => {
                  void upload("logo", e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <p className="mt-1 text-xs text-ink-soft">PNG, JPG ou WEBP até 1 MB. Fundo transparente fica melhor.</p>
            </div>
            <div>
              <span className="field-label">Banner / plano de fundo</span>
              <div className="relative h-24 overflow-hidden rounded-md border border-line bg-[#03060d]">
                {preview.bannerUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.bannerUrl} alt="Banner enviado" className="h-full w-full object-cover" />
                ) : (
                  <div className="login-backdrop absolute inset-0 grid place-items-center text-xs font-semibold text-[#8ea3c4]">Banner padrão</div>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn btn-small" disabled={uploading !== null} onClick={() => bannerInput.current?.click()}>
                  {uploading === "banner" ? "Enviando..." : draft.banner_path ? "Substituir banner" : "Enviar banner"}
                </button>
                {draft.banner_path && (
                  <button type="button" className="btn btn-small" onClick={() => setDraft({ ...draft, banner_path: null })}>
                    Usar banner padrão
                  </button>
                )}
              </div>
              <input
                ref={bannerInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                data-upload="banner"
                onChange={(e) => {
                  void upload("banner", e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <p className="mt-1 text-xs text-ink-soft">PNG, JPG ou WEBP até 4 MB, mínimo 800×400 px. Recomendado 1920×1080.</p>
            </div>
          </div>
        </div>

        <div>
          <span className="field-label">Prévia</span>
          <ScaledPreview draft={draft} supabaseUrl={supabaseUrl} />
          <p className="mt-1 text-xs text-ink-soft">{dirty ? "Alterações ainda não salvas." : "É o que aparece hoje em /login."}</p>
        </div>
      </div>

      {state.error && (
        <p role="alert" className="rounded-md bg-[#fdecea] px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.ok && !state.error && (
        <p role="status" className="text-sm font-semibold text-ok">
          {state.ok}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => setFullPreview(true)}>
          Visualizar prévia
        </button>
        <button type="button" className="btn btn-primary" disabled={!dirty || state.busy || uploading !== null} onClick={save}>
          {state.busy ? "Salvando..." : "Salvar alterações"}
        </button>
        <button type="button" className="btn sm:ml-auto" disabled={state.busy} onClick={() => setConfirmReset(true)}>
          Restaurar padrão
        </button>
      </div>

      {fullPreview && (
        <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Prévia da tela de login">
          <LoginScreen branding={preview} />
          <div className="fixed top-3 right-3 z-10 flex items-center gap-2">
            <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white">Prévia{dirty ? " (não salva)" : ""}</span>
            <button type="button" className="btn btn-small" onClick={() => setFullPreview(false)} autoFocus>
              Fechar prévia
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Restaurar o padrão DirectPlaca"
        description="A tela de login volta a usar a logo, o banner e os textos padrão. As imagens enviadas não são apagadas."
        confirmLabel="Restaurar padrão"
        busy={state.busy}
        error={confirmReset ? state.error : null}
        onCancel={() => setConfirmReset(false)}
        onConfirm={reset}
      />
    </div>
  );
}
