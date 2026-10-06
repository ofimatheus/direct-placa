import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { OUTPUTS_BUCKET } from "@/lib/storage";
import { layoutFromVersion } from "@/lib/templates/layout";
import { getVersion, previewPath } from "@/lib/templates/service";
import { buildQrUrl } from "@/lib/plates/urls";

/**
 * Confere a senha do ADMIN logado contra o Supabase Auth, com um cliente
 * descartável (sem guardar sessão). O e-mail vem da SESSÃO, nunca do pedido.
 * A sessão criada para conferir é encerrada em seguida. A senha não é
 * guardada, registrada nem devolvida.
 */
export async function verifyAdminPassword(
  email: string | null | undefined,
  userId: string,
  password: string,
  makeClient: () => Pick<SupabaseClient, "auth"> = () => {
    const env = getPublicEnv();
    return createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  },
): Promise<boolean> {
  if (!email || !password || password.length > 200) return false;
  const client = makeClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.user || data.user.id !== userId) return false;
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}

export interface DeletedPlate {
  id: string;
  public_code: string;
  batch_id: string | null;
}

/**
 * Remove do Storage SÓ os arquivos exclusivos das placas excluídas: o PNG em
 * cache da arte individual (previews/plates/<chave da placa>). Não toca em
 * pacotes do lote (compartilhados), artes base, versões de template, landing,
 * branding ou DirectLink.
 */
export async function removeDeletedPlateOutputs(admin: SupabaseClient, plates: DeletedPlate[]): Promise<{ paths: string[]; removed: number }> {
  const batchIds = [...new Set(plates.map((p) => p.batch_id).filter((b): b is string => !!b))];
  if (batchIds.length === 0) return { paths: [], removed: 0 };
  const { data: batches, error } = await admin.from("plate_batches").select("id, template_version_id").in("id", batchIds);
  if (error) throw error;
  const versionByBatch = new Map<string, Awaited<ReturnType<typeof getVersion>>>();
  for (const b of (batches ?? []) as { id: string; template_version_id: string | null }[]) {
    if (b.template_version_id) versionByBatch.set(b.id, await getVersion(admin, b.template_version_id));
  }
  const paths = plates.flatMap((p) => {
    const version = p.batch_id ? versionByBatch.get(p.batch_id) : undefined;
    return version ? [previewPath("plates", layoutFromVersion(version), version.base_image_sha256, p.public_code, buildQrUrl(p.public_code))] : [];
  });
  let removed = 0;
  for (let i = 0; i < paths.length; i += 1000) {
    const { data, error: rmError } = await admin.storage.from(OUTPUTS_BUCKET).remove(paths.slice(i, i + 1000));
    if (rmError) throw rmError;
    removed += data?.length ?? 0;
  }
  return { paths, removed };
}

export const KEPT_REASON_LABEL: Record<string, string> = {
  sale: "venda de revendedor",
  order: "pedido/venda do ADMIN",
  customer: "cliente vinculado",
  reseller: "revendedor (atual ou anterior)",
  activation: "ativação ou destino configurado",
  accesses: "acessos registrados",
};
