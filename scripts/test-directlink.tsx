/**
 * DirectLink: normalização e links por tipo, bloqueio de esquemas perigosos,
 * página pública (SSR), PIX (cópia), editor (ordem/estado/prévia/ids) e
 * "Usar em uma placa" pela rota existente. Sem cota do Google.
 *   npm run test:directlink
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

process.env.NEXT_PUBLIC_GO_BASE_URL = "https://go.directplaca.com.br";
const win = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Node", "Event", "MouseEvent", "KeyboardEvent", "getComputedStyle"]) {
  const value = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
Object.defineProperty(globalThis, "self", { value: win, configurable: true, writable: true });
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, d ?? "");
  }
};

async function main() {
  const { directLinkPublicUrl, itemHref, normalizeItemValue } = await import("@/lib/directlink/items");
  const { normalizeItemsForSave } = await import("@/lib/directlink/schema");

  // L1: normalização por tipo
  const n = (t: Parameters<typeof normalizeItemValue>[0], v: string) => {
    const r = normalizeItemValue(t, v);
    return r.ok ? r.value : `ERRO:${r.error}`;
  };
  check(n("instagram", "@adegamonster") === "https://instagram.com/adegamonster", "L1 instagram @", n("instagram", "@adegamonster"));
  check(n("instagram", "https://www.instagram.com/adega/") === "https://www.instagram.com/adega/", "L1 instagram url");
  check(n("whatsapp", "(11) 99999-8888") === "5511999998888", "L1 whatsapp", n("whatsapp", "(11) 99999-8888"));
  check(n("youtube", "youtube.com/@adega") === "https://youtube.com/@adega", "L1 youtube sem https");
  check(n("facebook", "https://facebook.com/adega") === "https://facebook.com/adega", "L1 facebook");
  check(n("phone", "+55 (11) 3333-4444") === "+551133334444" && n("email", "Contato@Adega.com.br") === "contato@adega.com.br", "L1 telefone/e-mail");
  check(n("pix", "  adega@monster.com.br ") === "adega@monster.com.br", "L1 pix não vira URL");
  check(n("site", "http://adega.com.br") === "http://adega.com.br", "L1 http permitido");
  for (const [t, v] of [["link", "javascript:alert(1)"], ["site", "data:text/html,<script>x</script>"], ["link", "file:///etc/passwd"], ["site", "ftp://a.com.br"], ["menu", "vbscript:x"], ["whatsapp", "123"], ["email", "sem-arroba"]] as const)
    check(n(t, v).startsWith("ERRO:"), `L1 recusa ${t} ${v}`);
  ok("L1: @perfil → URL do Instagram; (11) 99999-8888 → 5511999998888; https:// completado; http aceito; PIX não é URL; javascript:, data:, file:, ftp:, vbscript: recusados");

  // L2: link final de cada botão (e revalidação ao exibir)
  check(itemHref({ type: "whatsapp", title: "", value: "5511999998888" }) === "https://wa.me/5511999998888", "L2 whatsapp");
  check(itemHref({ type: "phone", title: "", value: "+551133334444" }) === "tel:+551133334444", "L2 tel");
  check(itemHref({ type: "email", title: "", value: "a@b.com.br" }) === "mailto:a@b.com.br", "L2 mailto");
  check(itemHref({ type: "pix", title: "", value: "chave" }) === null, "L2 pix sem link");
  check(itemHref({ type: "link", title: "", value: "javascript:alert(1)" }) === null && itemHref({ type: "site", title: "", value: "data:text/html,x" }) === null, "L2 valor perigoso não vira link");
  check(directLinkPublicUrl("ABC2345") === "https://go.directplaca.com.br/link/ABC2345", "L2 URL pública");
  let threw = false;
  try {
    normalizeItemsForSave([{ type: "link", title: "x", value: "javascript:alert(1)", is_active: true }]);
  } catch (e) {
    threw = (e as { status?: number }).status === 422;
  }
  const saved = normalizeItemsForSave([{ type: "site", title: "Site", value: "adega.com.br", receiver_name: "não é pix", is_active: true }]);
  check(threw && saved[0]!.value === "https://adega.com.br" && saved[0]!.receiver_name === null, "L2 servidor normaliza e recusa", saved);
  ok("L2: WhatsApp → wa.me, telefone → tel:, e-mail → mailto:, PIX sem link; valor perigoso nunca vira link (revalidado ao exibir); a API recusa com 422");

  // L3: página pública (SSR)
  const React = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { DirectLinkView } = await import("@/components/directlink/DirectLinkView");
  const html = renderToString(
    <DirectLinkView
      title="<b>Adega</b> Monster"
      description="Bebidas • Delivery"
      bannerUrl="https://proj.supabase.co/storage/v1/object/public/directlink-assets/x.png"
      items={[
        { type: "instagram", title: "Instagram", value: "https://instagram.com/adega" },
        { type: "whatsapp", title: "WhatsApp", value: "5511999998888" },
        { type: "pix", title: "PIX", value: "adega@monster.com.br", receiver_name: "Adega" },
        { type: "youtube", title: "YouTube", value: "https://youtube.com/@adega" },
        { type: "facebook", title: "Facebook", value: "https://facebook.com/adega" },
        { type: "link", title: "Perigoso", value: "javascript:alert(1)" },
      ]}
    />,
  );
  check(html.includes('href="https://instagram.com/adega"') && html.includes('href="https://wa.me/5511999998888"') && html.includes('href="https://youtube.com/@adega"') && html.includes('href="https://facebook.com/adega"'), "L3 links");
  check((html.match(/rel="noopener noreferrer"/g) ?? []).length === 4 && (html.match(/target="_blank"/g) ?? []).length === 4, "L3 noopener");
  check(!html.includes("javascript:") && !html.includes("Perigoso") && html.includes("&lt;b&gt;Adega&lt;/b&gt;") && !html.includes("<b>Adega"), "L3 sem HTML/JS injetado");
  check(html.includes('data-dl-item="pix"') && !html.includes("adega@monster.com.br"), "L3 PIX não expõe a chave antes do toque");
  ok("L3: Instagram, WhatsApp, YouTube e Facebook viram links que abrem em nova aba com noopener; HTML no título é texto; botão perigoso some; a chave PIX só aparece ao tocar");

  // L4: PIX copia a chave
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { PixButton } = await import("@/components/directlink/PixButton");
  let clip = "";
  let alerts = 0;
  Object.defineProperty(win.navigator, "clipboard", { value: { writeText: async (t: string) => void (clip = t) }, configurable: true });
  (globalThis as Record<string, unknown>).alert = () => void alerts++;
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root = createRoot(container as unknown as Element);
  const click = async (el: unknown) => act(async () => void (el as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event));
  const q = <T,>(s: string) => container.querySelector(s) as unknown as T;
  await act(async () => root.render(<PixButton item={{ type: "pix", title: "Pagar com PIX", value: "12.345.678/0001-90", receiver_name: "Adega Monster LTDA" }} className="btn" />));
  await click(q('[data-dl-item="pix"]'));
  check(q("[data-pix-sheet]") && container.textContent?.includes("Pagamento via PIX") && q<HTMLElement>("[data-pix-key]").textContent === "12.345.678/0001-90" && container.textContent?.includes("Adega Monster LTDA"), "L4 painel");
  await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Copiar chave"));
  check(clip === "12.345.678/0001-90" && q<HTMLElement>("[data-pix-status]").textContent === "Chave PIX copiada" && alerts === 0, "L4 cópia", clip);
  await act(async () => void document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }) as unknown as Event));
  check(!q("[data-pix-sheet]"), "L4 Esc fecha");
  ok("L4: PIX abre 'Pagamento via PIX' com a chave e o recebedor; 'Copiar chave' usa a Clipboard API e mostra 'Chave PIX copiada' (sem alert); Esc fecha");

  // L5: editor — ordem, estado, prévia, ids e Usar em uma placa
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { DirectLinkEditor } = await import("@/components/directlink/DirectLinkEditor");
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  (globalThis as Record<string, unknown>).fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    const reply = url === "/api/directlab/directlinks"
      ? { id: "0b6f1d2e-3c4a-4e5f-8a9b-1c2d3e4f5a6b", public_code: "ABC2345", item_ids: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"] }
      : url.startsWith("/api/directlab/plates")
        ? { role: "reseller", plates: [{ id: "p-1", public_code: "JKJ4NN", status: "assigned", customer_id: "c-1", customer_name: "Adega", reseller_name: null, destination_type: null, destination_url: null }] }
        : { plate: { status: "active" } };
    return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  window.history.replaceState = () => undefined;
  root.unmount();
  root = createRoot(container as unknown as Element);
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  await act(async () => root.render(<AppRouterContext.Provider value={router as never}><DirectLinkEditor role="reseller" initial={null} supabaseUrl="https://proj.supabase.co" basePath="/reseller/directlab/directlink" /></AppRouterContext.Provider>));
  const type = async (el: unknown, v: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(el, v);
      (el as HTMLElement).dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
    });
  const choose = async (v: string) =>
    act(async () => {
      const sel = container.querySelector('select[aria-label="Tipo do novo botão"]')!;
      Object.getOwnPropertyDescriptor(win.HTMLSelectElement.prototype, "value")!.set!.call(sel, v);
      sel.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
    });
  const addBtn = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Adicionar"));
  await type(q("[data-dl-title]"), "Adega Monster");
  for (const t of ["instagram", "whatsapp", "pix"]) {
    await choose(t);
    await click(addBtn());
  }
  const destinos = () => [...container.querySelectorAll("[data-dl-editor-item]")].map((li) => li.querySelectorAll("input.input")[1] as unknown as HTMLInputElement);
  await type(destinos()[0], "@adegamonster");
  await type(destinos()[1], "(11) 99999-8888");
  await type(destinos()[2], "adega@monster.com.br");
  const previewOrder = () => [...container.querySelectorAll("[data-dl-preview] [data-dl-item]")].map((e) => e.getAttribute("data-dl-item"));
  check(previewOrder().join(",") === "instagram,whatsapp,pix", "L5 prévia inicial", previewOrder());
  await click(container.querySelector('button[aria-label="Descer Instagram"]'));
  check(previewOrder().join(",") === "whatsapp,instagram,pix", "L5 reordenar", previewOrder());
  const pixItem = [...container.querySelectorAll("[data-dl-editor-item]")][2]!;
  await click(pixItem.querySelector('input[type="checkbox"]'));
  check(previewOrder().join(",") === "whatsapp,instagram", "L5 inativo some da prévia", previewOrder());
  await click(q("[data-dl-save]"));
  const save1 = calls.find((c) => c.url === "/api/directlab/directlinks")!;
  const items1 = save1.body!.items as { type: string; id: string | null; is_active: boolean }[];
  check(items1.map((i) => i.type).join(",") === "whatsapp,instagram,pix" && items1[2]!.is_active === false && items1.every((i) => i.id === null), "L5 1º salvamento", items1);
  check(q<HTMLInputElement>("[data-dl-url]").value === "https://go.directplaca.com.br/link/ABC2345", "L5 URL pública exibida");
  await click(q("[data-dl-save]"));
  const save2 = calls.filter((c) => c.url === "/api/directlab/directlinks")[1]!;
  check((save2.body!.items as { id: string }[]).map((i) => i.id).join(",") === "11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222,33333333-3333-4333-8333-333333333333" && save2.body!.id === "0b6f1d2e-3c4a-4e5f-8a9b-1c2d3e4f5a6b", "L5 2º salvamento mantém ids", save2.body);
  ok("L5: adicionar botões, ↑/↓ e ativo/inativo refletem na prévia; a ordem é enviada; após criar, os botões mantêm os mesmos ids nas edições seguintes");

  await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Usar em uma placa"));
  await act(async () => void (await new Promise((r) => setTimeout(r, 350))));
  await click([...container.querySelectorAll("[data-plate-list] button")][0]);
  await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Continuar"));
  check(container.textContent?.includes("DirectLink — https://go.directplaca.com.br/link/ABC2345"), "L6 confirmação");
  await click(container.querySelector("[data-confirm]"));
  const apply = calls.find((c) => c.url === "/api/reseller/plates/p-1");
  check(apply && apply.method === "POST" && JSON.stringify(apply.body) === JSON.stringify({ customer_id: "c-1", destination_type: "website", destination_url: "https://go.directplaca.com.br/link/ABC2345" }), "L6 rota existente", apply);
  ok("L6: 'Usar em uma placa' lista só as placas permitidas e grava pela rota existente da placa (mesma ativação), com a URL pública do DirectLink");

  // L7: DirectLink não usa a cota do Google nem a Places API
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?)$/.test(name)) {
        const src = readFileSync(p, "utf8");
        if (/directlab\/quota|consumeDirectLab|directlab_consume|places\.googleapis|lib\/directlab\/places|consumeQuota/.test(src)) offenders.push(p);
      }
    }
  };
  for (const dir of ["src/lib/directlink", "src/components/directlink", "src/app/api/directlab/directlinks", "src/app/link"]) walk(join(process.cwd(), dir));
  check(offenders.length === 0, "L7 cota", offenders);
  ok("L7: nenhum código do DirectLink (rotas, página pública, componentes) usa a cota do DirectLab ou a Places API");

  const { DirectLabTools } = await import("@/components/directlab/DirectLabTools");
  const tools = renderToString(<AppRouterContext.Provider value={router as never}><DirectLabTools role="reseller" /></AppRouterContext.Provider>);
  check(tools.includes('data-directlab-card="google-review"') && tools.includes('data-directlab-card="directlink"') && tools.includes('href="/reseller/directlab/directlink"') && tools.includes('href="/reseller/directlab/google-review"') && !tools.includes("data-directlab-tool"), "L8 DirectLab (hub: só os cards, sem o formulário)");
  ok("L8: o hub do DirectLab mostra os cards Avaliação Google e DirectLink, cada um levando à página própria (formulário não fica no hub)");

  await act(async () => root.unmount());
  if (failures) {
    console.log(`${failures} falha(s)`);
    process.exit(1);
  }
  console.log("DirectLink OK");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
