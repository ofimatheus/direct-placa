"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface CarouselProduct {
  id: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  title: string;
  text: string;
}

/** Intervalo do movimento automático (suave e espaçado). */
const AUTOPLAY_MS = 4500;
/** Depois de um toque/arrasto, o movimento automático espera este tempo. */
const RESUME_AFTER_TOUCH_MS = 8000;

/**
 * Carrossel da seção "Nossos Produtos".
 *   · rolagem nativa com encaixe (swipe no celular e touchpad funcionam e não
 *     bloqueiam a rolagem vertical); arrastar com o mouse também funciona;
 *   · setas, indicadores (até 12 posições) e teclado (← → Home End);
 *   · movimento automático suave, que NÃO roda com prefers-reduced-motion,
 *     com 1 produto, fora da tela, nem enquanto o usuário interage; há botão
 *     de pausar/retomar; ao chegar ao fim, volta ao início (sem duplicar cards);
 *   · imagens carregadas aos poucos (só as próximas da área visível).
 */
export function ProductsCarousel({ items, label }: { items: CarouselProduct[]; label: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const single = items.length <= 1;
  const [index, setIndex] = useState(0);
  const [positions, setPositions] = useState(1);
  const [canScroll, setCanScroll] = useState(false);
  const [loadUpTo, setLoadUpTo] = useState(Math.min(items.length, 5));
  const [reduced, setReduced] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [inView, setInView] = useState(true);
  const lastTouch = useRef(0);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  const step = () => {
    const t = trackRef.current;
    const first = t?.querySelector<HTMLElement>("[data-product-card]");
    if (!t || !first) return 0;
    const gap = parseFloat(getComputedStyle(t).columnGap || "0") || 0;
    return first.offsetWidth + gap;
  };
  const maxIndex = () => {
    const t = trackRef.current;
    const s = step();
    return t && s ? Math.max(0, Math.round((t.scrollWidth - t.clientWidth) / s)) : 0;
  };

  const goTo = useCallback(
    (i: number) => {
      const t = trackRef.current;
      if (!t) return;
      const max = maxIndex();
      const target = i > max ? 0 : i < 0 ? max : i;
      t.scrollTo({ left: target * step(), behavior: reduced ? "auto" : "smooth" });
    },
    [reduced],
  );

  // Medidas: posição atual, quantas posições existem, se há o que rolar e quais imagens carregar.
  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    const update = () => {
      const s = step();
      const i = s ? Math.round(t.scrollLeft / s) : 0;
      const visible = s ? Math.max(1, Math.ceil(t.clientWidth / s)) : 1;
      setIndex(i);
      setPositions(maxIndex() + 1);
      setCanScroll(t.scrollWidth - t.clientWidth > 4);
      setLoadUpTo((n) => Math.max(n, Math.min(items.length, i + visible + 2)));
    };
    update();
    t.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(t);
    return () => {
      t.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [items.length]);

  // Preferência por menos movimento.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(mq.matches);
    set();
    mq.addEventListener?.("change", set);
    return () => mq.removeEventListener?.("change", set);
  }, []);

  // Só anda sozinho quando está visível na tela.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(Boolean(e?.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Movimento automático.
  const autoplay = !single && canScroll && !reduced && !paused && !hover && !focus && !dragging && inView;
  useEffect(() => {
    if (!autoplay) return;
    const id = setInterval(() => {
      if (document.hidden || Date.now() - lastTouch.current < RESUME_AFTER_TOUCH_MS) return;
      const t = trackRef.current;
      const s = step();
      if (!t || !s) return;
      goTo(Math.round(t.scrollLeft / s) + 1);
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [autoplay, goTo]);

  // Arrastar com o mouse (toque e touchpad usam a rolagem nativa).
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !canScroll) return;
    const t = trackRef.current;
    if (!t) return;
    drag.current = { x: e.clientX, left: t.scrollLeft, moved: false };
    setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const t = trackRef.current;
      if (!t || !drag.current) return;
      const dx = e.clientX - drag.current.x;
      if (Math.abs(dx) > 3) drag.current.moved = true;
      t.scrollLeft = drag.current.left - dx;
    };
    const up = () => {
      const t = trackRef.current;
      const s = step();
      setDragging(false);
      drag.current = null;
      if (t && s) goTo(Math.round(t.scrollLeft / s));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, goTo]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (single) return;
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: positions - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    goTo(keys[e.key]!);
  };

  return (
    <div
      ref={rootRef}
      className="landing-products"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocus(true)}
      onBlurCapture={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onTouchStart={() => (lastTouch.current = Date.now())}
      data-products-carousel=""
      data-autoplay={autoplay ? "on" : "off"}
    >
      <div
        ref={trackRef}
        className={`landing-products-track ${canScroll ? "" : "is-static"} ${dragging ? "is-dragging" : ""}`}
        role="region"
        aria-roledescription="carrossel"
        aria-label={label}
        tabIndex={single ? -1 : 0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        data-products-track=""
      >
        {items.map((item, i) => (
          <article key={item.id} className="landing-product-card" role="group" aria-roledescription="produto" aria-label={`${i + 1} de ${items.length}`} data-product-card="">
            <div className="landing-product-media">
              {i < loadUpTo ? (
                // Imagem enviada pelo ADMIN (Storage) ou do projeto; carregamento preguiçoso e sem distorção (contain).
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.src} alt={item.alt} width={item.width} height={item.height} loading="lazy" decoding="async" draggable={false} />
              ) : (
                <span className="landing-product-placeholder" aria-hidden />
              )}
            </div>
            {(item.title || item.text) && (
              <div className="landing-product-body">
                {item.title && <h3 className="landing-wrap font-bold">{item.title}</h3>}
                {item.text && <p className={`landing-wrap text-sm leading-relaxed text-ink-soft ${item.title ? "mt-1" : ""}`}>{item.text}</p>}
              </div>
            )}
          </article>
        ))}
      </div>

      {!single && canScroll && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3" data-products-controls="">
          {positions > 1 && positions <= 12 ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Posição no carrossel">
              {Array.from({ length: positions }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`landing-products-dot ${i === Math.min(index, positions - 1) ? "is-active" : ""}`}
                  aria-label={`Ir para a posição ${i + 1} de ${positions}`}
                  aria-current={i === Math.min(index, positions - 1) ? "true" : undefined}
                  onClick={() => goTo(i)}
                />
              ))}
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {!reduced && (
              <button type="button" className="landing-products-btn" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Retomar movimento automático" : "Pausar movimento automático"} aria-pressed={paused} data-products-pause="">
                {paused ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5.5v13l10.5-6.5z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
                  </svg>
                )}
              </button>
            )}
            <button type="button" className="landing-products-btn" onClick={() => goTo(index - 1)} aria-label="Produto anterior" data-products-prev="">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m14.5 6-6 6 6 6" />
              </svg>
            </button>
            <button type="button" className="landing-products-btn" onClick={() => goTo(index + 1)} aria-label="Próximo produto" data-products-next="">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m9.5 6 6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
