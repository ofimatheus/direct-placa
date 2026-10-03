import { splitBrandName } from "@/lib/branding/defaults";

/**
 * Marca padrão DirectPlaca em SVG (o "D" com o triângulo de play azul).
 *   tile → dentro de um quadrado escuro arredondado (topo do card de login)
 *   bare → só o símbolo, grande (banner padrão)
 * O ADMIN pode substituir por uma logo enviada em Configurações.
 */
export function BrandMark({ variant = "tile", className = "" }: { variant?: "tile" | "bare"; className?: string }) {
  const id = variant;
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="DirectPlaca">
      <defs>
        <linearGradient id={`dp-tri-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38d6ff" />
          <stop offset="1" stopColor="#1d5cff" />
        </linearGradient>
        <linearGradient id={`dp-d-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a4a66" />
          <stop offset="1" stopColor="#1c2638" />
        </linearGradient>
        <linearGradient id={`dp-tile-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#141c2c" />
          <stop offset="1" stopColor="#070b14" />
        </linearGradient>
      </defs>
      {variant === "tile" && <rect x="0.5" y="0.5" width="63" height="63" rx="14" fill={`url(#dp-tile-${id})`} stroke="rgba(96,165,250,0.28)" />}
      <g transform={variant === "tile" ? "translate(12 13) scale(0.62)" : undefined}>
        <path d="M22 6h12c16 0 26 11.5 26 26S50 58 34 58H22" fill="none" stroke={`url(#dp-d-${id})`} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.5 15.5c0-3 3.2-4.9 5.8-3.4l26.4 16c2.5 1.5 2.5 5.3 0 6.8l-26.4 16c-2.6 1.6-5.8-.4-5.8-3.4z" fill={`url(#dp-tri-${id})`} />
      </g>
    </svg>
  );
}

/** Nome da marca em duas cores ("Direct" claro + "Placa" azul). */
export function Wordmark({ name, className = "" }: { name: string; className?: string }) {
  const [first, second] = splitBrandName(name);
  return (
    <span className={`login-wordmark ${className}`}>
      <span className="login-wordmark-base">{first}</span>
      {second && <span className="login-wordmark-accent">{second}</span>}
    </span>
  );
}
