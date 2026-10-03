import "server-only";
import type { Exporter } from "../types";

/**
 * Reservado para a próxima etapa: PDF de impressão (uma placa por página no
 * tamanho físico print_width_mm × print_height_mm, ou imposição em folha).
 * O tipo já existe no banco e na fila; basta implementar step/finalize.
 */
export const artPdfExporter: Exporter = {
  async step() {
    throw new Error("A exportação em PDF ainda não está disponível.");
  },
  async finalize() {
    throw new Error("A exportação em PDF ainda não está disponível.");
  },
};
