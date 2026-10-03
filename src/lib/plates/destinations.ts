import { z } from "zod";
import type { DestinationType } from "@/lib/db/types";

export const DESTINATION_TYPES: readonly { value: DestinationType; label: string; placeholder: string }[] = [
  { value: "google_review", label: "Avaliação no Google", placeholder: "https://g.page/r/..." },
  { value: "whatsapp", label: "WhatsApp", placeholder: "https://wa.me/5511999999999" },
  { value: "instagram", label: "Instagram", placeholder: "https://instagram.com/perfil" },
  { value: "menu", label: "Cardápio", placeholder: "https://..." },
  { value: "pix", label: "Pix", placeholder: "https://..." },
  { value: "website", label: "Site", placeholder: "https://..." },
  { value: "custom", label: "Outro link", placeholder: "https://..." },
];

export const DESTINATION_LABEL = Object.fromEntries(DESTINATION_TYPES.map((d) => [d.value, d.label])) as Record<
  DestinationType,
  string
>;

const DESTINATION_VALUES = DESTINATION_TYPES.map((d) => d.value) as [DestinationType, ...DestinationType[]];

/** Mesma regra de public.is_valid_destination_url (o banco sempre revalida). */
const URL_RE = /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(:[0-9]{1,5})?([/?#]\S*)?$/i;

export function isValidDestinationUrl(value: string): boolean {
  return value.length <= 2048 && URL_RE.test(value);
}

export const destinationSchema = z
  .object({
    customer_id: z.string().uuid().nullable(),
    destination_type: z.enum(DESTINATION_VALUES).nullable(),
    destination_url: z.string().trim().max(2048).nullable(),
  })
  .transform((v) => ({ ...v, destination_url: v.destination_url ? v.destination_url : null }))
  .superRefine((v, ctx) => {
    if (v.destination_url && !isValidDestinationUrl(v.destination_url)) {
      ctx.addIssue({ code: "custom", path: ["destination_url"], message: "Informe uma URL válida começando com http:// ou https://" });
    }
    if (v.destination_url && !v.destination_type) {
      ctx.addIssue({ code: "custom", path: ["destination_type"], message: "Escolha o tipo de destino" });
    }
  });
