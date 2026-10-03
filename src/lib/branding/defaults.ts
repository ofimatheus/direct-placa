/**
 * Branding da tela de login. Tudo aqui é público e seguro para o navegador.
 * Campo ausente/nulo na configuração = padrão DirectPlaca abaixo, então a tela
 * de login sempre tem o que mostrar, mesmo sem banco.
 */
export interface BrandingRow {
  brand_name: string | null;
  show_brand_name: boolean | null;
  eyebrow: string | null;
  title: string | null;
  subtitle: string | null;
  logo_path: string | null;
  banner_path: string | null;
}

export interface LoginBranding {
  brandName: string;
  showBrandName: boolean;
  eyebrow: string;
  title: string;
  subtitle: string;
  /** null = logo padrão (SVG embutido no código). */
  logoUrl: string | null;
  /** null = banner padrão (arte em CSS/SVG embutida no código). */
  bannerUrl: string | null;
  /** true quando veio do banco; false quando é o padrão (sem configuração ou banco indisponível). */
  customized: boolean;
}

export const DEFAULT_BRANDING: LoginBranding = {
  brandName: "DirectPlaca",
  showBrandName: true,
  eyebrow: "Acesso à plataforma",
  title: "Entrar",
  subtitle: "Gerencie placas, revendedores e clientes em um só lugar.",
  logoUrl: null,
  bannerUrl: null,
  customized: false,
};

export const BRANDING_LIMITS = {
  brandName: 40,
  eyebrow: 60,
  title: 60,
  subtitle: 200,
} as const;

export const BRANDING_BUCKET = "branding";
const PATH_RE = /^(logo|banner)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

/** URL pública de um asset do bucket 'branding'. Recusa qualquer caminho fora do padrão gerado pelo upload. */
export function brandingPublicUrl(supabaseUrl: string, path: string | null | undefined): string | null {
  if (!path || !PATH_RE.test(path) || !supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${BRANDING_BUCKET}/${path}`;
}

const text = (value: string | null | undefined, fallback: string, max: number) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
};

/** Combina a configuração salva com o padrão, campo a campo. Nunca lança. */
export function resolveBranding(row: BrandingRow | null | undefined, supabaseUrl: string): LoginBranding {
  if (!row) return DEFAULT_BRANDING;
  return {
    brandName: text(row.brand_name, DEFAULT_BRANDING.brandName, BRANDING_LIMITS.brandName),
    showBrandName: row.show_brand_name ?? true,
    eyebrow: text(row.eyebrow, DEFAULT_BRANDING.eyebrow, BRANDING_LIMITS.eyebrow),
    title: text(row.title, DEFAULT_BRANDING.title, BRANDING_LIMITS.title),
    subtitle: text(row.subtitle, DEFAULT_BRANDING.subtitle, BRANDING_LIMITS.subtitle),
    logoUrl: brandingPublicUrl(supabaseUrl, row.logo_path),
    bannerUrl: brandingPublicUrl(supabaseUrl, row.banner_path),
    customized: true,
  };
}

/**
 * Divide o nome da marca em duas cores, como na identidade DirectPlaca
 * ("Direct" branco + "Placa" azul): na última palavra, se houver espaço; senão
 * na última maiúscula interna ("DirectPlaca" → "Direct" + "Placa").
 */
export function splitBrandName(name: string): [string, string] {
  const trimmed = name.trim();
  const space = trimmed.lastIndexOf(" ");
  if (space > 0) return [trimmed.slice(0, space + 1), trimmed.slice(space + 1)];
  for (let i = trimmed.length - 1; i > 0; i--) {
    const ch = trimmed[i]!;
    if (ch !== ch.toLowerCase() && ch === ch.toUpperCase() && /\p{L}/u.test(ch)) return [trimmed.slice(0, i), trimmed.slice(i)];
  }
  return [trimmed, ""];
}
