/**
 * "Usar em uma placa" NÃO tem regra própria: monta a MESMA chamada que a
 * tela da placa faz hoje.
 *   · revendedor → POST  /api/reseller/plates/[id]  (RPC configure_reseller_plate)
 *   · ADMIN      → PATCH /api/admin/plates/[id]
 * Ativação, dono da placa, cliente e bloqueio continuam decididos por essas
 * rotas e pelo banco. O cliente atual da placa é mantido.
 */
export type DirectLabRole = "admin" | "reseller";

export interface ApplyTarget {
  id: string;
  customer_id: string | null;
}

export function buildApplyRequest(
  role: DirectLabRole,
  plate: ApplyTarget,
  destinationUrl: string,
  destinationType: "google_review" | "website" = "google_review",
) {
  return {
    url: role === "admin" ? `/api/admin/plates/${plate.id}` : `/api/reseller/plates/${plate.id}`,
    method: role === "admin" ? "PATCH" : "POST",
    body: { customer_id: plate.customer_id, destination_type: destinationType, destination_url: destinationUrl },
  };
}

export function platePagePath(role: DirectLabRole, plateId: string): string {
  return role === "admin" ? `/admin/plates/${plateId}` : `/reseller/plates/${plateId}`;
}
