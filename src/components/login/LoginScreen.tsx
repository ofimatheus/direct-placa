import type { LoginBranding } from "@/lib/branding/defaults";
import { BrandMark, Wordmark } from "./BrandMark";
import { ArrowIcon, ChartIcon, MailIcon, PeopleIcon, PlateIcon, ShieldIcon } from "./LoginIcons";
import { PasswordInput } from "./PasswordInput";

interface Props {
  branding: LoginBranding;
  /** Server action de login. Ausente = prévia (campos desabilitados, nada é enviado). */
  formAction?: (formData: FormData) => void | Promise<void>;
  error?: string | null;
  next?: string;
}

/** Logo do card: a enviada pelo ADMIN ou a marca padrão. */
function CardLogo({ branding }: { branding: LoginBranding }) {
  const onlyLogo = !branding.showBrandName;
  return (
    <div className="flex min-w-0 items-center justify-center gap-3" data-login-logo="">
      {branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logoUrl}
          alt={onlyLogo ? branding.brandName : ""}
          className={onlyLogo ? "h-[var(--lg-logo-only)] w-auto max-w-[260px] object-contain" : "h-[var(--lg-logo)] w-auto max-w-[120px] object-contain"}
        />
      ) : (
        <BrandMark variant="tile" className={onlyLogo ? "size-[var(--lg-logo-only)] shrink-0" : "size-[var(--lg-logo)] shrink-0"} />
      )}
      {!onlyLogo && <Wordmark name={branding.brandName} className="truncate text-[length:var(--lg-wordmark)]" />}
    </div>
  );
}

/** Fundo padrão (sem banner enviado): preto/navy com o arco azul luminoso. */
function DefaultBackdrop() {
  return (
    <div className="login-backdrop absolute inset-0" data-login-banner="default">
      <svg className="login-arc absolute top-0 left-0 h-full w-[66%] max-w-[980px]" viewBox="0 0 1000 1000" preserveAspectRatio="xMinYMid slice" aria-hidden>
        <defs>
          <linearGradient id="login-arc-fill" x1="0" y1="0" x2="1" y2="0.6">
            <stop offset="0" stopColor="#0d2f8f" stopOpacity="0.7" />
            <stop offset="0.7" stopColor="#0b1f5c" stopOpacity="0.4" />
            <stop offset="1" stopColor="#081230" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="login-arc-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1e40ff" stopOpacity="0.1" />
            <stop offset="0.45" stopColor="#3b82f6" />
            <stop offset="0.75" stopColor="#7dd3fc" />
            <stop offset="1" stopColor="#1d4ed8" stopOpacity="0.2" />
          </linearGradient>
          <filter id="login-arc-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>
        <path d="M-60 -40 C 330 10, 690 250, 858 390 Q 905 432, 858 474 C 690 620, 330 870, -60 1040 Z" fill="url(#login-arc-fill)" />
        <path d="M-60 -40 C 330 10, 690 250, 858 390 Q 905 432, 858 474 C 690 620, 330 870, -60 1040" fill="none" stroke="url(#login-arc-stroke)" strokeWidth="14" filter="url(#login-arc-glow)" opacity="0.9" />
        <path d="M-60 -40 C 330 10, 690 250, 858 390 Q 905 432, 858 474 C 690 620, 330 870, -60 1040" fill="none" stroke="url(#login-arc-stroke)" strokeWidth="2.5" />
      </svg>
    </div>
  );
}

/** Conteúdo do banner padrão (só aparece enquanto não houver banner enviado). */
function DefaultHero({ branding }: { branding: LoginBranding }) {
  const features = [
    { icon: PlateIcon, label: ["Gestão", "de placas"] },
    { icon: PeopleIcon, label: ["Revendedores", "e clientes"] },
    { icon: ChartIcon, label: ["Acompanhamento", "de pedidos"] },
  ];
  return (
    <div className="max-w-[560px] pl-2 xl:pl-10">
      {branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={branding.logoUrl} alt="" className="h-40 w-auto max-w-[360px] object-contain" />
      ) : (
        <BrandMark variant="bare" className="ml-[4.5rem] size-44 drop-shadow-[0_0_40px_rgba(37,99,235,0.45)]" />
      )}
      <Wordmark name={branding.brandName} className="mt-2 block text-[4.2rem] leading-none xl:text-[4.8rem]" />
      <p className="mt-4 text-[0.8rem] font-semibold tracking-[0.42em] text-[#8ea3c4]">PLACAS QUE MOVEM NEGÓCIOS</p>
      <span className="mt-10 block h-[3px] w-16 rounded-full bg-gradient-to-r from-[#1d6bff] to-[#22d3ee]" />
      <p className="mt-7 text-[2.35rem] leading-[1.15] font-bold text-white">
        Mais controle
        <br />
        para o seu negócio.
      </p>
      <p className="mt-4 max-w-[430px] text-[1.15rem] leading-relaxed text-[#93a4c3]">
        Gerencie placas, revendedores, clientes e pedidos em um só lugar, com segurança e praticidade.
      </p>
      <ul className="mt-10 grid grid-cols-3 gap-6">
        {features.map(({ icon: FeatureIcon, label }) => (
          <li key={label[0]} className="text-[0.95rem] leading-snug text-[#dbe5f5]">
            <span className="mb-4 grid size-14 place-items-center rounded-xl border border-[#2b5bd7]/60 bg-[#0c1a3a]/70 text-[#3d8bff] shadow-[0_0_24px_rgba(37,99,235,0.25)]">
              <FeatureIcon className="size-6" />
            </span>
            {label[0]}
            <br />
            {label[1]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Tela de login. O visual fixo (fundo escuro, card com borda azul luminosa,
 * campos escuros, botão azul → ciano) é código; o ADMIN personaliza banner,
 * logo, nome, título, subtítulo e o texto de acesso. O formulário NUNCA faz
 * parte do banner: trocar a imagem não mexe no login.
 */
export function LoginScreen({ branding, formAction, error, next }: Props) {
  const preview = !formAction;
  const hasBanner = Boolean(branding.bannerUrl);

  return (
    <main className="login-root relative isolate min-h-dvh w-full overflow-hidden" data-login-screen="">
      <div className="absolute inset-0 -z-10" aria-hidden>
        {hasBanner ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={branding.bannerUrl!} alt="" className="h-full w-full object-cover" data-login-banner="custom" />
            <div className="login-banner-shade absolute inset-0" />
          </>
        ) : (
          <DefaultBackdrop />
        )}
      </div>

      <div className="mx-auto grid min-h-dvh w-full max-w-[1440px] content-center items-center gap-10 px-4 py-[var(--lg-page-py)] sm:px-8 lg:grid-cols-[minmax(0,1fr)_var(--lg-card-w)] lg:px-14 xl:gap-16">
        <section className="hidden lg:block" aria-hidden={hasBanner ? true : undefined}>
          {!hasBanner && <DefaultHero branding={branding} />}
        </section>

        <section className="login-card mx-auto w-full max-w-[var(--lg-card-w)] px-[var(--lg-pad-x)] py-[var(--lg-pad-y)]" aria-labelledby="login-title">
          <CardLogo branding={branding} />

          <p className="mt-[var(--lg-eyebrow-gap)] text-[length:var(--lg-eyebrow)] tracking-[0.3em] text-[#8e9bb3]" data-login-eyebrow="">
            {branding.eyebrow}
          </p>
          <h1 id="login-title" className="mt-[var(--lg-title-gap)] text-[length:var(--lg-title)] leading-none font-bold tracking-tight text-white">
            {branding.title}
          </h1>
          <p className="mt-[var(--lg-title-gap)] max-w-[370px] text-[length:var(--lg-subtitle)] leading-relaxed text-[#93a4c3]">{branding.subtitle}</p>

          <form action={formAction} className="mt-[var(--lg-form-mt)] space-y-[var(--lg-form-gap)]" data-login-form="">
            <input type="hidden" name="next" value={next ?? ""} />
            <div>
              <label htmlFor="email" className="login-label">
                E-mail
              </label>
              <div className="relative">
                <MailIcon className="login-field-icon" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  disabled={preview}
                  placeholder="seu@email.com"
                  className="login-input"
                />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="login-label">
                Senha
              </label>
              <PasswordInput disabled={preview} />
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-[#f87171]/40 bg-[#3b0d12]/60 px-3.5 py-2.5 text-sm text-[#fecaca]">
                {error}
              </p>
            )}

            <button type={preview ? "button" : "submit"} className="login-button" disabled={preview}>
              Entrar <ArrowIcon className="size-5" />
            </button>
          </form>

          <div className="mt-[var(--lg-form-mt)] flex items-center gap-4 text-[#5f6f8a]" aria-hidden>
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#26344d]" />
            <ShieldIcon className="size-5" />
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#26344d]" />
          </div>
          <p className="mt-3 text-center text-[length:var(--lg-foot)] text-[#8391a7]">Acesso seguro para administradores e revendedores</p>
        </section>
      </div>
    </main>
  );
}
