import { ITEM_TYPES, itemHref, type PublicItem } from "@/lib/directlink/items";
import { ItemIcon } from "./icons";
import { PixButton } from "./PixButton";

interface Props {
  title: string;
  description?: string | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  items: PublicItem[];
  /** Prévia no editor: ocupa a moldura em vez da tela inteira e não abre links. */
  preview?: boolean;
}

/**
 * Página pública do DirectLink (mobile-first). Também é a prévia do editor.
 * Largura máxima de 520 px centralizada no desktop; botões com a largura
 * toda e altura mínima de 52 px.
 */
export function DirectLinkView({ title, description, bannerUrl, logoUrl, items, preview = false }: Props) {
  return (
    <div className={`dl-root ${preview ? "min-h-full" : "min-h-dvh"} w-full bg-[#eef2f7]`} data-directlink-view="">
      <div className={`mx-auto flex w-full max-w-[520px] flex-col bg-white ${preview ? "min-h-full" : "min-h-dvh sm:my-6 sm:min-h-0 sm:rounded-3xl sm:shadow-[0_10px_40px_rgb(16_24_40/0.12)]"} overflow-hidden`}>
        <div className="relative aspect-[16/9] w-full shrink-0 bg-gradient-to-br from-[#0d1a2a] via-[#0b3f8f] to-[#0b63de]" data-dl-banner="">
          {bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
        </div>

        <div className="flex flex-1 flex-col px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="relative z-10 mx-auto -mt-12 size-24 shrink-0 rounded-full border-4 border-white bg-white object-cover shadow-md" data-dl-logo="" />
          ) : (
            <div className="h-4" />
          )}
          <h1 className="mt-3 text-center text-[1.6rem] leading-tight font-extrabold tracking-tight break-words text-[#0f1b2d]">{title}</h1>
          {description && <p className="mt-1.5 text-center text-[0.975rem] leading-snug break-words text-[#5b6b82]">{description}</p>}

          <ul className="mt-6 space-y-3" data-dl-items="">
            {items.map((item, index) => {
              const className =
                "dl-btn flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-[#e1e7ef] bg-white px-3.5 py-2.5 text-left text-[1rem] font-semibold text-[#0f1b2d] shadow-[0_1px_2px_rgb(16_24_40/0.05)] transition-colors hover:border-[#b9cdea] hover:bg-[#f7faff] active:bg-[#eef4ff]";
              if (item.type === "pix") {
                return (
                  <li key={index}>
                    <PixButton item={item} className={className} />
                  </li>
                );
              }
              const href = itemHref(item);
              if (!href) return null;
              const external = href.startsWith("http");
              return (
                <li key={index}>
                  <a
                    href={preview ? undefined : href}
                    target={external && !preview ? "_blank" : undefined}
                    rel={external ? "noopener noreferrer" : undefined}
                    className={className}
                    data-dl-item={item.type}
                    aria-label={`${item.title} (${ITEM_TYPES[item.type].label})`}
                  >
                    <span className="dl-btn-icon">
                      <ItemIcon type={item.type} />
                    </span>
                    <span className="dl-btn-title">{item.title}</span>
                  </a>
                </li>
              );
            })}
          </ul>
          {items.length === 0 && <p className="mt-6 text-center text-sm text-[#8a98ab]">Nenhum link por aqui ainda.</p>}

          <p className="mt-auto pt-8 text-center text-xs font-semibold tracking-wide text-[#9aa7b8]">DirectPlaca</p>
        </div>
      </div>
    </div>
  );
}
