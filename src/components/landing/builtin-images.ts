import type { StaticImageData } from "next/image";
import telaAvaliacao from "@/app/revendedores/_assets/tela-avaliacao-google.webp";
import telaClientes from "@/app/revendedores/_assets/tela-clientes.webp";
import telaDashboard from "@/app/revendedores/_assets/tela-dashboard.webp";
import telaDirectLab from "@/app/revendedores/_assets/tela-directlab.webp";
import telaDirectLink from "@/app/revendedores/_assets/tela-directlink-publico.webp";
import telaPlacas from "@/app/revendedores/_assets/tela-placas.webp";
import type { BuiltinImage } from "@/lib/landing/schema";

/** Capturas reais que vêm com o projeto (podem ser substituídas por imagens enviadas no CMS). */
export const BUILTIN_IMAGE_DATA: Record<BuiltinImage, StaticImageData> = {
  "tela-dashboard": telaDashboard,
  "tela-placas": telaPlacas,
  "tela-clientes": telaClientes,
  "tela-directlab": telaDirectLab,
  "tela-avaliacao-google": telaAvaliacao,
  "tela-directlink-publico": telaDirectLink,
};
