import type { DestinationType, PlateStatus } from "@/lib/db/types";

/** Placa oferecida em "Usar em uma placa" (GET /api/directlab/plates). */
export interface DirectLabPlateOption {
  id: string;
  public_code: string;
  status: PlateStatus;
  customer_id: string | null;
  customer_name: string | null;
  reseller_name: string | null;
  destination_type: DestinationType | null;
  destination_url: string | null;
}

/** Uso da cota diária do revendedor (ADMIN não tem cota diária). */
export interface QuotaSnapshot {
  used: number;
  limit: number;
}
