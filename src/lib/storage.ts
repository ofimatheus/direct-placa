import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/http";

export const TEMPLATES_BUCKET = "plate-templates";
export const OUTPUTS_BUCKET = "plate-outputs";

export async function downloadObject(sb: SupabaseClient, bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error || !data) {
    throw new HttpError(404, `Arquivo não encontrado no Storage (${bucket}/${path}).`);
  }
  return Buffer.from(await data.arrayBuffer());
}

function isAlreadyExists(error: unknown): boolean {
  const e = error as { statusCode?: string; status?: number; code?: string; message?: string };
  return (
    e.statusCode === "409" ||
    e.status === 409 ||
    e.code === "ResourceAlreadyExists" ||
    /already exists|duplicate/i.test(e.message ?? "")
  );
}

/**
 * Grava um arquivo que NUNCA deve ser sobrescrito (upsert: false).
 * Se o caminho já existe, o conteúdo é o mesmo (o nome é o sha256), então é sucesso.
 */
export async function putImmutableObject(
  sb: SupabaseClient,
  bucket: string,
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await sb.storage.from(bucket).upload(path, body, { contentType, upsert: false });
  if (error && !isAlreadyExists(error)) {
    throw new Error(`Falha ao gravar ${bucket}/${path}: ${error.message}`);
  }
}

/** Grava artefatos gerados (exports, previews). Podem ser regravados pelo próprio job. */
export async function putGeneratedObject(
  sb: SupabaseClient,
  bucket: string,
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await sb.storage.from(bucket).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`Falha ao gravar ${bucket}/${path}: ${error.message}`);
}

export async function objectExists(sb: SupabaseClient, bucket: string, path: string): Promise<boolean> {
  const { data, error } = await sb.storage.from(bucket).exists(path);
  return !error && data === true;
}

export async function signObject(
  sb: SupabaseClient,
  bucket: string,
  path: string,
  expiresInSeconds: number,
  downloadName?: string,
): Promise<string> {
  const { data, error } = await sb.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds, downloadName ? { download: downloadName } : undefined);
  if (error || !data) throw new HttpError(404, "Arquivo não encontrado.");
  return data.signedUrl;
}

export async function removeObjects(sb: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await sb.storage.from(bucket).remove(paths);
  if (error) console.warn(`Não foi possível remover ${paths.join(", ")}: ${error.message}`);
}
