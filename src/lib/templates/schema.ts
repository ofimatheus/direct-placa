/**
 * Validação de entrada (compartilhada entre formulário e API).
 * O servidor sempre revalida — nunca confia só no frontend.
 */
import { z } from "zod";
import { PLATE_FONT_KEYS } from "@/lib/renderer/fonts";

export const STAGING_PATH_RE = /^staging\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/;
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg"] as const;

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use uma cor no formato #RRGGBB");
const px = z.number().int("Use números inteiros (px)").min(0, "Não pode ser negativo");
const mm = z.number().positive("Deve ser maior que zero").max(5000, "Valor alto demais");

/** Campos de layout editáveis pelo ADMIN (a arte e suas dimensões vêm do upload). */
export const layoutInputSchema = z
  .object({
    print_width_mm: mm.nullable(),
    print_height_mm: mm.nullable(),
    qr_x: px,
    qr_y: px,
    qr_width: px.min(21, "O QR precisa de pelo menos 21 px"),
    qr_height: px.min(21, "O QR precisa de pelo menos 21 px"),
    qr_error_correction: z.enum(["L", "M", "Q", "H"]),
    qr_quiet_zone: z.number().int().min(0).max(10),
    qr_color: hexColor,
    qr_background_color: hexColor,
    show_public_code: z.boolean(),
    code_x: px,
    code_y: px,
    code_font_family: z.enum(PLATE_FONT_KEYS),
    code_font_size: z.number().int().min(6, "Mínimo 6 px").max(2000),
    code_color: hexColor,
    code_align: z.enum(["left", "center", "right"]),
    code_max_width: px.min(1).nullable(),
    safe_margin: px.nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.qr_width !== value.qr_height) {
      ctx.addIssue({ code: "custom", path: ["qr_height"], message: "O QR é quadrado: largura e altura devem ser iguais" });
    }
    if ((value.print_width_mm === null) !== (value.print_height_mm === null)) {
      ctx.addIssue({ code: "custom", path: ["print_height_mm"], message: "Informe largura e altura de impressão, ou nenhuma" });
    }
  });

export type LayoutInput = z.infer<typeof layoutInputSchema>;

export const imageRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("staging"), path: z.string().regex(STAGING_PATH_RE, "Caminho de upload inválido") }),
  z.object({ kind: z.literal("version"), versionId: z.string().uuid() }),
]);
export type ImageRef = z.infer<typeof imageRefSchema>;

export const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(ACCEPTED_IMAGE_TYPES),
  size: z.number().int().positive(),
});

export const templateMetaSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120),
  internal_key: z
    .string()
    .trim()
    .min(1, "Informe a chave interna")
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens (ex.: google-preto)"),
  description: z.string().trim().max(1000).nullable(),
});

export const createTemplateSchema = templateMetaSchema.extend({
  image: imageRefSchema,
  layout: layoutInputSchema,
});

export const updateTemplateMetaSchema = templateMetaSchema.partial().extend({
  active: z.boolean().optional(),
});

export const saveLayoutSchema = z.object({
  image: imageRefSchema,
  layout: layoutInputSchema,
});

export const previewRequestSchema = saveLayoutSchema;
