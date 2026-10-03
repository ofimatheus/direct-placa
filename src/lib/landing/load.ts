import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { getPublicEnv } from "@/lib/env";
import { defaultLandingContent } from "./defaults";
import { validateLandingContent, type LandingContent } from "./schema";

export type LandingSource = "published" | "default" | "fallback";

export interface LoadedLanding {
  content: LandingContent;
  /** published = conteúdo do CMS; default = nada publicado ainda; fallback = banco indisponível no build. */
  source: LandingSource;
  publishedAt: string | null;
}

/** Códigos de "estrutura do CMS ausente" (migration ainda não aplicada). */
const NOT_INSTALLED = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);
const isBuild = () => process.env.NEXT_PHASE === "phase-production-build";

/** Cliente anônimo, sem cookies: a página pública é estática (ISR) e lê só o publicado. */
function anonClient(): SupabaseClient {
  const env = getPublicEnv();
  return createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Conteúdo PUBLICADO da landing (público). Disponibilidade:
 *   · nada publicado / migration não aplicada → conteúdo padrão (a landing original), com aviso no log;
 *   · erro do banco DURANTE o build → conteúdo padrão (o build não quebra), com erro no log;
 *   · erro do banco em produção → o erro é registrado e LANÇADO: o Next continua
 *     servindo a última versão gerada da página (ISR), sem tela branca e sem
 *     esconder o problema.
 */
export const loadPublishedLanding = cache((): Promise<LoadedLanding> => loadPublishedLandingFrom(anonClient()));

/** Mesma regra, com o cliente injetado (testes). */
export async function loadPublishedLandingFrom(client: Pick<SupabaseClient, "rpc">): Promise<LoadedLanding> {
  try {
    const { data, error } = await client.rpc("public_landing_content");
    if (error) {
      if (NOT_INSTALLED.has(error.code ?? "")) {
        console.warn("landing_cms_not_installed", { code: error.code });
        return { content: defaultLandingContent(), source: "default", publishedAt: null };
      }
      throw Object.assign(new Error("landing_published_rpc_failed"), { code: error.code });
    }
    const row = (Array.isArray(data) ? data[0] : data) as { content?: unknown; published_at?: string | null } | undefined;
    if (!row?.content) return { content: defaultLandingContent(), source: "default", publishedAt: null };
    const valid = validateLandingContent(row.content);
    if (!valid.ok) throw Object.assign(new Error("landing_published_invalid"), { code: "invalid_content", errors: valid.errors });
    return { content: valid.content, source: "published", publishedAt: row.published_at ?? null };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "fetch_failed";
    console.error("landing_published_load_failed", { code });
    if (isBuild()) return { content: defaultLandingContent(), source: "fallback", publishedAt: null };
    throw error;
  }
}

export interface LandingAdminState {
  installed: boolean;
  draft: LandingContent;
  /** 0 = ainda não há rascunho salvo (o editor parte do publicado ou do padrão). */
  draftVersion: number;
  draftUpdatedAt: string | null;
  published: LandingContent | null;
  publishedVersion: number | null;
  publishedAt: string | null;
  /** O rascunho difere do publicado? */
  hasUnpublishedChanges: boolean;
}

interface StateRow {
  draft: unknown;
  draft_version: number | null;
  draft_updated_at: string | null;
  published: unknown;
  published_version: number | null;
  published_at: string | null;
}

/** Estado do CMS para o ADMIN (usa a sessão do ADMIN; o banco confere is_admin()). */
export async function loadLandingAdminState(sb: SupabaseClient): Promise<LandingAdminState> {
  const { data, error } = await sb.rpc("admin_landing_state");
  if (error) {
    if (NOT_INSTALLED.has(error.code ?? "")) {
      const content = defaultLandingContent();
      return { installed: false, draft: content, draftVersion: 0, draftUpdatedAt: null, published: null, publishedVersion: null, publishedAt: null, hasUnpublishedChanges: false };
    }
    throw Object.assign(new Error("landing_state_failed"), { code: error.code });
  }
  const row = ((Array.isArray(data) ? data[0] : data) ?? {}) as Partial<StateRow>;
  const published = row.published ? validateLandingContent(row.published) : null;
  const draft = row.draft ? validateLandingContent(row.draft) : null;
  const publishedContent = published?.ok ? published.content : null;
  const draftContent = draft?.ok ? draft.content : (publishedContent ?? defaultLandingContent());
  return {
    installed: true,
    draft: draftContent,
    draftVersion: row.draft_version ?? 0,
    draftUpdatedAt: row.draft_updated_at ?? null,
    published: publishedContent,
    publishedVersion: row.published_version ?? null,
    publishedAt: row.published_at ?? null,
    hasUnpublishedChanges: publishedContent ? JSON.stringify(draftContent) !== JSON.stringify(publishedContent) : row.draft_version != null,
  };
}
