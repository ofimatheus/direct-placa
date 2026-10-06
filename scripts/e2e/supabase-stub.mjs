/**
 * Supabase SIMULADO para o teste ponta a ponta da tela de login.
 * Atende só o que /login usa: a RPC pública de branding, as imagens do bucket
 * público, o login (Auth) e a leitura do perfil. Nada de dados reais.
 *   GET /__mode?m=default|custom|swap|only-logo|error|hang
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.STUB_PORT ?? 54399);
const FIXTURES = process.env.STUB_FIXTURES ?? "/tmp/e2e-fixtures";
const USERS = {
  "admin@teste.com": { id: "0f6c6c55-6a52-4a8e-9a55-1b1f0a0e0001", role: "admin", active: true },
  "revenda@teste.com": { id: "0f6c6c55-6a52-4a8e-9a55-1b1f0a0e0002", role: "reseller", active: true },
  "inativo@teste.com": { id: "0f6c6c55-6a52-4a8e-9a55-1b1f0a0e0003", role: "reseller", active: false },
};
const PASSWORD = "Senha-Forte-2026";
const LOGO = "logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png";
const BANNER_A = "banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.png";
const BANNER_B = "banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2.jpg";
let mode = "default";
/** Ações em massa de placas (migration 029): chamadas recebidas (função, quantidade de ids, motivo). */
const plateBulkCalls = [];
/** Quantas vezes a cobrança (directlab_charge_generation) foi chamada — para o E2E provar que pesquisa/erro não cobram. */
let chargeCalls = 0;
/** Link curto da Avaliação Google (migration 028), em memória: código → destino. */
const reviewLinks = new Map();
let finalizeCalls = 0;
let reviewLookups = 0;
/** CMS da landing (migration 027), em memória: rascunho e publicado. */
let landingDraft = null; // { content, version, updated_at }
let landingPublished = null; // { content, version, published_at }
export const requests = [];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (user) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.stub`;
const userById = (id) => Object.entries(USERS).find(([, u]) => u.id === id);

function brandingRow() {
  const base = { brand_name: null, show_brand_name: true, eyebrow: null, title: null, subtitle: null, logo_path: null, banner_path: null };
  if (mode === "custom") return { ...base, brand_name: "Marca Parceira", title: "Bem-vindo", subtitle: "Portal do parceiro.", logo_path: LOGO, banner_path: BANNER_A };
  if (mode === "swap") return { ...base, brand_name: "Marca Parceira", title: "Bem-vindo", subtitle: "Portal do parceiro.", logo_path: LOGO, banner_path: BANNER_B };
  if (mode === "only-logo") return { ...base, brand_name: "Marca Parceira", show_brand_name: false, logo_path: LOGO };
  return base;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://stub");
  requests.push(`${req.method} ${url.pathname}`);
  // Junta os BYTES e decodifica uma vez só: concatenar pedaços como texto quebra
  // caracteres de mais de um byte (ex.: "ç") que caiam na fronteira entre pedaços.
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const json = (status, data) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    if (url.pathname === "/__calls") return json(200, { chargeCalls, finalizeCalls, reviewLookups });
    if (url.pathname === "/__review-link") {
      reviewLinks.set(url.searchParams.get("code"), url.searchParams.get("dest"));
      return json(200, { ok: true });
    }
    if (url.pathname === "/rest/v1/rpc/public_review_link") {
      reviewLookups++;
      const { p_code } = JSON.parse(body || "{}");
      return json(200, reviewLinks.get(String(p_code).toUpperCase()) ?? null);
    }
    if (url.pathname === "/rest/v1/rpc/directlab_finalize_generation") {
      finalizeCalls++;
      return json(200, [{ allowed: true, charged: true, used_today: 6, daily_limit: 10, retry_after_seconds: 0, public_code: "A7K4829" }]);
    }
    if (url.pathname === "/__landing") {
      if (url.searchParams.get("reset") === "1") landingDraft = landingPublished = null;
      return json(200, { draft: landingDraft, published: landingPublished });
    }
    if (url.pathname.startsWith("/rest/v1/rpc/") && url.pathname.includes("landing")) {
      const fn = url.pathname.replace("/rest/v1/rpc/", "");
      const args = JSON.parse(body || "{}");
      const conflict = () => json(400, { code: "55000", message: "O rascunho foi alterado em outra aba ou por outra pessoa. Recarregue a página para continuar.", details: null, hint: null });
      if (fn === "public_landing_content") return json(200, landingPublished ? [{ content: landingPublished.content, published_at: landingPublished.published_at, version: landingPublished.version }] : []);
      if (fn === "admin_landing_state")
        return json(200, [{ draft: landingDraft?.content ?? null, draft_version: landingDraft?.version ?? null, draft_updated_at: landingDraft?.updated_at ?? null, published: landingPublished?.content ?? null, published_version: landingPublished?.version ?? null, published_at: landingPublished?.published_at ?? null }]);
      if (fn === "admin_landing_save_draft") {
        if ((landingDraft?.version ?? 0) !== args.p_expected_version) return conflict();
        landingDraft = { content: args.p_content, version: (landingDraft?.version ?? 0) + 1, updated_at: new Date().toISOString() };
        return json(200, landingDraft.version);
      }
      if (fn === "admin_landing_publish") {
        if (!landingDraft || landingDraft.version !== args.p_expected_version) return conflict();
        const at = new Date().toISOString();
        landingPublished = { content: landingDraft.content, version: landingDraft.version, published_at: at };
        return json(200, at);
      }
      if (fn === "admin_landing_discard_draft") {
        landingDraft = landingPublished ? { content: landingPublished.content, version: (landingDraft?.version ?? 0) + 1, updated_at: new Date().toISOString() } : null;
        return json(200, null);
      }
      if (fn === "admin_landing_media_list") return json(200, []);
    }
    if (url.pathname === "/__mode") {
      mode = url.searchParams.get("m") ?? "default";
      return json(200, { mode });
    }
    if (url.pathname === "/rest/v1/rpc/public_login_branding") {
      if (mode === "hang") return; // nunca responde
      if (mode === "error") return json(500, { message: "indisponível" });
      return json(200, [brandingRow()]);
    }
    if (url.pathname.startsWith("/storage/v1/object/public/branding/")) {
      const path = url.pathname.replace("/storage/v1/object/public/branding/", "");
      const file = { [LOGO]: "logo.png", [BANNER_A]: "banner-a.png", [BANNER_B]: "banner-b.jpg" }[path];
      if (!file) return res.writeHead(404).end();
      return res.writeHead(200, { "Content-Type": file.endsWith(".jpg") ? "image/jpeg" : "image/png" }).end(readFileSync(join(FIXTURES, file)));
    }
    if (url.pathname === "/auth/v1/token") {
      const { email, password } = JSON.parse(body || "{}");
      const user = USERS[email];
      if (!user || password !== PASSWORD) return json(400, { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials" });
      const u = { id: user.id, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      return json(200, { access_token: jwt({ ...u }), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "refresh-stub", user: u });
    }
    if (url.pathname === "/auth/v1/user") {
      const token = (req.headers.authorization ?? "").replace("Bearer ", "");
      try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
        const found = userById(payload.sub);
        if (found) return json(200, { id: payload.sub, email: found[0], aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} });
      } catch {}
      return json(401, { message: "invalid token" });
    }
    if (url.pathname === "/auth/v1/logout") return res.writeHead(204).end();
    if (url.pathname === "/rest/v1/profiles") {
      const id = (url.searchParams.get("id") ?? "").replace("eq.", "");
      const found = userById(id);
      const row = found ? { id, role: found[1].role, active: found[1].active, email: found[0], name: found[0] } : null;
      const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
      return single ? (row ? json(200, row) : json(406, { message: "no rows" })) : json(200, row ? [row] : []);
    }
    if (url.pathname === "/rest/v1/rpc/public_direct_link") {
      const { p_code } = JSON.parse(body || "{}");
      if (String(p_code).toUpperCase() !== "ABC2345") return json(200, null);
      return json(200, {
        code: "ABC2345",
        title: "Adega Monster Conveniência, Tabacaria e Delivery 24 horas",
        description: "Bebidas geladas • Conveniência • Delivery rápido em toda a região de Barueri",
        // Modo "sem-imagens": a mesma página sem banner e sem logo (ambos opcionais).
        banner_path: mode === "sem-imagens" ? null : "e6000000-0000-0000-0000-0000000000a1/banner/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.png",
        logo_path: mode === "sem-imagens" ? null : "e6000000-0000-0000-0000-0000000000a1/logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png",
        items: [
          { type: "instagram", title: "Instagram", value: "https://instagram.com/adegamonster" },
          { type: "whatsapp", title: "Peça pelo WhatsApp e receba em até 30 minutos na sua casa", value: "5511999998888" },
          { type: "pix", title: "Pagar com PIX", value: "adega@monster.com.br", receiver_name: "Adega Monster LTDA" },
          { type: "menu", title: "Cardápio", value: "https://adega.com.br/cardapio" },
          { type: "maps", title: "Localização", value: "https://maps.google.com/?q=Adega" },
          { type: "youtube", title: "YouTube", value: "https://youtube.com/@adega" },
          { type: "facebook", title: "Facebook", value: "https://facebook.com/adega" },
          { type: "phone", title: "Ligar", value: "+551133334444" },
          { type: "email", title: "E-mail", value: "contato@adega.com.br" },
        ],
      });
    }
    if (url.pathname.startsWith("/storage/v1/object/public/directlink-assets/")) {
      const file = url.pathname.includes("/logo/") ? "logo.png" : "banner-a.png";
      return res.writeHead(200, { "Content-Type": "image/png" }).end(readFileSync(join(FIXTURES, file)));
    }
    // Integração Google Places (migration 025). Modo "places-key": o ADMIN salvou
    // uma chave FALSA no Vault. Sem o modo, não há chave do ADMIN.
    if (url.pathname === "/rest/v1/rpc/google_places_api_key") return json(200, mode === "places-key" ? PLACES_FAKE_KEY : null);
    if (url.pathname === "/rest/v1/rpc/admin_google_places_status") {
      const custom = mode === "places-key";
      return json(200, [{ custom_configured: custom, key_last4: custom ? PLACES_FAKE_KEY.slice(-4) : null, configured_at: custom ? new Date().toISOString() : null, last_test_status: null, last_test_source: null, last_test_at: null }]);
    }
    if (url.pathname === "/rest/v1/rpc/admin_google_places_record_test" || url.pathname === "/rest/v1/rpc/admin_google_places_remove") return json(200, null);
    if (url.pathname === "/rest/v1/rpc/directlab_consume") return json(200, [{ allowed: true, reason: null, used_today: 5, daily_limit: 10, retry_after_seconds: 0 }]);
    // Cobrança só no sucesso (migration 026).
    if (url.pathname === "/rest/v1/rpc/directlab_generation_check") return json(200, [{ allowed: true, already_generated: false, used_today: 5, daily_limit: 10, retry_after_seconds: 0 }]);
    if (url.pathname === "/rest/v1/rpc/directlab_charge_generation") return (chargeCalls++, json(200, [{ allowed: true, charged: true, used_today: 6, daily_limit: 10, retry_after_seconds: 0 }]));
    // Modo "sem-directlink": banco SEM a migration 20261004120000_directlink.sql
    // (o PostgREST responde PGRST205, tabela fora do schema cache).
    if (mode === "sem-directlink" && (url.pathname === "/rest/v1/direct_links" || url.pathname === "/rest/v1/rpc/directlink_page_status")) {
      return json(404, { code: "PGRST205", message: "Could not find the table 'public.direct_links' in the schema cache", details: null, hint: null });
    }
    if (url.pathname === "/__plates-bulk") return json(200, { calls: plateBulkCalls });
    if (url.pathname === "/rest/v1/rpc/consume_rate_limit") return json(200, [{ allowed: true, hits: 1, retry_after_seconds: 0 }]);
    if (url.pathname.startsWith("/rest/v1/rpc/admin_plates_")) {
      const fn = url.pathname.replace("/rest/v1/rpc/", "");
      const args = JSON.parse(body || "{}");
      const n = (args.p_plate_ids ?? []).length;
      plateBulkCalls.push({ fn, n, reason: args.p_reason ?? null });
      if (fn === "admin_plates_quarantine") return json(200, [{ quarantined: n, already: 0, skipped: 0, skipped_codes: [], missing: 0 }]);
      if (fn === "admin_plates_restore") return json(200, [{ restored: n, not_quarantined: 0, still_batch_quarantine: 0, missing: 0 }]);
      if (fn === "admin_plates_delete_unused") {
        const kept = Math.min(3, n);
        return json(200, [{ deleted: n - kept, deleted_plates: [], kept, kept_by_reason: kept ? { reseller: kept } : {}, kept_codes: ["QYM2T6", "WFBPYC", "YHDR9B"].slice(0, kept), missing: 0 }]);
      }
    }
    // Dados de demonstração dos dashboards (valores iguais às referências aprovadas).
    const demo = demoResponse(req.method, url);
    if (demo) {
      const headers = { "Content-Type": "application/json", ...(demo.range ? { "Content-Range": demo.range } : {}) };
      return res.writeHead(200, headers).end(req.method === "HEAD" ? undefined : JSON.stringify(demo.body));
    }
    if (url.pathname === "/rest/v1/reseller_profiles") {
      const userId = (url.searchParams.get("user_id") ?? "").replace("eq.", "");
      const found = userById(userId);
      const row = found && found[1].role === "reseller" ? { id: "5e11e700-0000-4000-8000-000000000001", user_id: userId, company_name: "Revenda Teste" } : null;
      const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
      return single ? (row ? json(200, row) : json(406, { message: "no rows" })) : json(200, row ? [row] : []);
    }
    return (req.headers.accept ?? "").includes("vnd.pgrst.object") ? json(406, {}) : json(200, []);
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`stub Supabase em http://127.0.0.1:${PORT}`));

/** Chave FALSA (formato válido) usada só pelo simulador. */
const PLACES_FAKE_KEY = "AIzaFAKEE2EchaveFalsaDoSimulador000X9zQ";

function demoResponse(method, url) {
  const path = url.pathname;
  const day = (offset) => {
    const d = new Date(Date.now() - offset * 86400000);
    return d.toISOString().slice(0, 10);
  };
  const rpc = {
    admin_dashboard_metrics: { revenue: 115, sales: 1, plates_sold: 5, plates_produced: 5, plates_in_stock: 0, plates_with_resellers: 5, plates_configured: 1, plates_active: 1 },
    admin_revenue_series: Array.from({ length: 30 }, (_, i) => ({ bucket_start: `${day(29 - i)} 00:00:00`, revenue: i === 29 ? 115 : 0, sales: i === 29 ? 1 : 0 })),
    admin_top_resellers: [{ reseller_id: "5e11e700-0000-4000-8000-000000000001", company_name: "Jorge LTDA", revenue: 115, sales: 1, plates: 5 }],
    reseller_dashboard_metrics: { plates: 5, available: 4, configured: 1, active: 1, inactive: 0, accesses: 1, customers: 2 },
    reseller_sales_metrics: { revenue: 100, sales: 1, plates: 1, average_ticket: 100 },
    reseller_sales_revenue_series: [5, 4, 3, 2, 1, 0].map((m) => ({ month: `2026-${String(9 - m).padStart(2, "0")}-01`, revenue: m === 0 ? 100 : 0, sales: m === 0 ? 1 : 0 })),
    reseller_sales_list: [{ sale_id: "5a1e0000-0000-4000-8000-000000000001", status: "paid", total: 100, sold_at: day(0), notes: null, customer_id: null, customer_name: "MTS Corporation", plate_count: 1, created_at: new Date().toISOString(), total_count: 1 }],
  };
  // Modo "long": valores grandes para provar que os KPIs não cortam números reais.
  if (mode === "long") {
    rpc.admin_dashboard_metrics = { revenue: 1234567.89, sales: 12345, plates_sold: 98765, plates_produced: 123456, plates_in_stock: 45678, plates_with_resellers: 77778, plates_configured: 65432, plates_active: 54321 };
    rpc.reseller_dashboard_metrics = { plates: 12345, available: 6789, configured: 5556, active: 5000, inactive: 556, accesses: 98765, customers: 4321 };
    rpc.reseller_sales_metrics = { revenue: 987654.32, sales: 1234, plates: 5678, average_ticket: 800.37 };
  }
  // Limites do DirectLab do revendedor (migration 024). Modo "limite": tudo esgotado.
  rpc.directlab_quota_status = [{ role: "reseller", used_today: mode === "limite" ? 10 : 4, daily_limit: 10 }];
  rpc.directlink_page_status = [{ role: "reseller", used: mode === "limite" ? 3 : 2, page_limit: 3 }];
  const name = path.replace("/rest/v1/rpc/", "");
  if (path.startsWith("/rest/v1/rpc/") && name in rpc) return { body: rpc[name] };
  if (path === "/rest/v1/direct_links") {
    const now = new Date().toISOString();
    return {
      body: [
        { id: "d1000000-0000-4000-8000-000000000001", public_code: "ABC2345", title: "Adega Monster", is_active: true, updated_at: now, reseller_id: "5e11e700-0000-4000-8000-000000000001" },
        { id: "d1000000-0000-4000-8000-000000000002", public_code: "XYZ6789", title: "Barbearia Jorge", is_active: false, updated_at: now, reseller_id: null },
      ],
    };
  }
  if (path === "/rest/v1/redirects") {
    if (method === "HEAD") return { body: [], range: "*/1" };
    return { body: [{ id: 1, plate_id: "9a7e0000-0000-4000-8000-000000000004", source: "qr", created_at: new Date(Date.now() - 3600000).toISOString() }] };
  }
  // Admin › Placas: contadores das abas (HEAD) e "selecionar todas do filtro" (só ids).
  if (path === "/rest/v1/plates" && url.searchParams.get("select") === "id") {
    const total = mode === "plates-1000" ? 1000 : 5;
    if (method === "HEAD") return { body: [], range: `*/${total}` };
    const ids = Array.from({ length: total }, (_, i) => `9a7e0000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    return { body: ids.map((id) => ({ id })), range: `0-${total - 1}/${total}` };
  }
  if (path === "/rest/v1/plates" && (url.searchParams.get("select") ?? "").includes("public_code")) {
    const codes = ["QYM2T6", "WFBPYC", "YHDR9B", "Z99KXQ", "2KDQP2"];
    return {
      body: codes.map((code, i) => ({
        id: `9a7e0000-0000-4000-8000-00000000000${i}`, public_code: code, reseller_id: "5e11e700-0000-4000-8000-000000000001",
        customer_id: i === 4 ? "c0000000-0000-4000-8000-000000000001" : null, batch_id: null,
        destination_type: i === 4 ? "google_review" : null, destination_url: i === 4 ? "https://google.com/maps" : null,
        status: i === 4 ? "active" : "assigned", qr_access_count: i === 4 ? 1 : 0, last_qr_access_at: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })),
      range: mode === "plates-1000" ? "0-4/1000" : "0-4/5",
    };
  }
  if (path === "/rest/v1/customers") return { body: [{ id: "c0000000-0000-4000-8000-000000000001", name: "Marcos", company_name: "MTS Corporation" }] };
  return null;
}
