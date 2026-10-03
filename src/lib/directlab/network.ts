import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DirectLabError } from "./errors";

/**
 * true para endereços que o servidor NUNCA deve acessar: loopback, redes
 * privadas, link-local (inclui 169.254.169.254, metadados de nuvem), CGNAT,
 * multicast, reservados e os equivalentes IPv6 (inclui IPv4 mapeado).
 */
export function isForbiddenAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number, number, number];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (version === 6) {
    const ip = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isForbiddenAddress(mapped[1]!);
    return (
      ip === "::" || ip === "::1" ||
      ip.startsWith("fc") || ip.startsWith("fd") ||
      /^fe[89ab]/.test(ip) ||
      ip.startsWith("ff") ||
      ip.startsWith("64:ff9b:") ||
      ip.startsWith("2001:db8")
    );
  }
  return true; // não é IP: recusa por segurança
}

export type LookupFn = (hostname: string) => Promise<string[]>;

export const defaultLookup: LookupFn = async (hostname) => (await dnsLookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

/** Recusa host que seja IP literal ou que resolva para qualquer endereço proibido. */
export async function assertPublicHost(hostname: string, lookup: LookupFn): Promise<void> {
  if (isIP(hostname.replace(/^\[|\]$/g, ""))) throw new DirectLabError("redirect_blocked", `IP literal ${hostname}`);
  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch (error) {
    throw new DirectLabError("google_unavailable", `DNS falhou para ${hostname}: ${(error as Error).message}`);
  }
  if (addresses.length === 0) throw new DirectLabError("google_unavailable", `DNS vazio para ${hostname}`);
  const bad = addresses.find(isForbiddenAddress);
  if (bad) throw new DirectLabError("redirect_blocked", `${hostname} resolve para endereço proibido ${bad}`);
}
