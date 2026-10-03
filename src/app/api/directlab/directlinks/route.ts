import { NextResponse } from "next/server";
import { requireDirectLabApi } from "@/lib/auth/session";
import { directLinkPublicUrl } from "@/lib/directlink/items";
import { directLinkSaveSchema, normalizeItemsForSave } from "@/lib/directlink/schema";
import { errorResponse, httpErrorFromDb, readJson } from "@/lib/http";

/**
 * Cria (sem id) ou edita (com id) um DirectLink e seus botões.
 * O banco confere a posse (revendedor só os próprios; ADMIN todos) — um id
 * alheio vira 404. NÃO usa Google Places nem a cota diária do DirectLab.
 */
export async function POST(request: Request) {
  const auth = await requireDirectLabApi();
  if (!auth.ok) return auth.response;
  try {
    const body = directLinkSaveSchema.parse(await readJson(request));
    const items = normalizeItemsForSave(body.items);
    const { data, error } = await auth.session.supabase.rpc("directlink_save", {
      p_id: body.id ?? null,
      p_title: body.title,
      p_description: body.description ?? null,
      p_banner_path: body.banner_path,
      p_logo_path: body.logo_path,
      p_is_active: body.is_active,
      p_items: items,
    });
    if (error) throw httpErrorFromDb(error, "Não foi possível salvar o DirectLink.");
    const row = (Array.isArray(data) ? data[0] : data) as { id: string; public_code: string };
    // Ids dos botões na ordem salva: o editor passa a editar os mesmos registros.
    const { data: saved } = await auth.session.supabase.from("direct_link_items").select("id").eq("direct_link_id", row.id).order("sort_order");
    return NextResponse.json(
      { id: row.id, public_code: row.public_code, url: directLinkPublicUrl(row.public_code), item_ids: ((saved ?? []) as { id: string }[]).map((i) => i.id) },
      { status: body.id ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
