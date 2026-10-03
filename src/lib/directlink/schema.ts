import { z } from "zod";
import { HttpError } from "@/lib/http";
import { ITEM_TYPE_ORDER, ITEM_TYPES, MAX_ITEMS, normalizeItemValue, type DirectLinkItemType } from "./items";

const assetPath = (kind: "banner" | "logo") =>
  z
    .string()
    .regex(new RegExp(`^[0-9a-f-]{36}/${kind}/[0-9a-f-]{36}\\.(png|jpg|webp)$`), "Imagem inválida: envie de novo.")
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const directLinkItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  type: z.enum(ITEM_TYPE_ORDER as [DirectLinkItemType, ...DirectLinkItemType[]]),
  title: z.string().trim().min(1, "Dê um título ao botão.").max(60),
  value: z.string().max(2048),
  receiver_name: z.string().trim().max(60).nullable().optional(),
  is_active: z.boolean().default(true),
});

export const directLinkSaveSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, "Informe o nome da página.").max(80),
  description: z.string().trim().max(160).nullable().optional(),
  banner_path: assetPath("banner"),
  logo_path: assetPath("logo"),
  is_active: z.boolean().default(true),
  items: z.array(directLinkItemSchema).max(MAX_ITEMS),
});

export type DirectLinkSaveInput = z.infer<typeof directLinkSaveSchema>;

/** Normaliza os botões (o banco valida de novo). Erro amigável com a posição do botão. */
export function normalizeItemsForSave(items: DirectLinkSaveInput["items"]) {
  return items.map((item, index) => {
    const normalized = normalizeItemValue(item.type, item.value);
    if (!normalized.ok) throw new HttpError(422, `Botão ${index + 1} (${ITEM_TYPES[item.type].label}): ${normalized.error}`);
    return {
      id: item.id ?? null,
      type: item.type,
      title: item.title,
      value: normalized.value,
      receiver_name: item.type === "pix" ? item.receiver_name || null : null,
      is_active: item.is_active,
    };
  });
}
