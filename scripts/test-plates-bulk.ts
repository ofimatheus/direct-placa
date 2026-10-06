/**
 * Ações em massa de Admin › Placas (servidor): senha do ADMIN, limpeza do
 * Storage (só o que é exclusivo da placa) e regras das rotas.
 *   npm run test:plates-bulk
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeDeletedPlateOutputs, verifyAdminPassword } from "@/lib/plates/bulk";
import { buildQrUrl } from "@/lib/plates/urls";
import { OUTPUTS_BUCKET } from "@/lib/storage";
import { layoutFromVersion } from "@/lib/templates/layout";
import { cachedRenderUrl, previewPath } from "@/lib/templates/service";

process.env.NEXT_PUBLIC_GO_BASE_URL ??= "https://go.meudominio.com";
let failures = 0;
const ok = (l: string) => console.log(`OK ${l}`);
const check = (c: unknown, l: string, d?: unknown) => {
  if (!c) {
    failures++;
    console.log(`FALHA ${l}`, JSON.stringify(d ?? "").slice(0, 300));
  }
};
const logs: string[] = [];
for (const lvl of ["log", "info", "warn", "error", "debug"] as const) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...a: unknown[]) => {
    logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    if (lvl === "log" && typeof a[0] === "string" && /^(OK|FALHA)/.test(a[0])) orig(...a);
  };
}

const SECRET = "Senha-Do-Admin-Que-Nao-Pode-Vazar-2026";
const ADMIN_ID = "a0000000-0000-4000-8000-00000000000a";

function fakeAuth(validPassword: string, userId: string) {
  const calls = { signIn: 0, signOut: 0 };
  const client = {
    auth: {
      signInWithPassword: async ({ password }: { email: string; password: string }) => {
        calls.signIn++;
        return password === validPassword ? { data: { user: { id: userId }, session: {} }, error: null } : { data: { user: null, session: null }, error: { message: "Invalid login credentials" } };
      },
      signOut: async () => {
        calls.signOut++;
        return { error: null };
      },
    },
  } as unknown as Pick<SupabaseClient, "auth">;
  return { client, calls };
}

async function main() {
  // ---------- S1: senha do ADMIN ----------
  const right = fakeAuth(SECRET, ADMIN_ID);
  const okPass = await verifyAdminPassword("admin@teste.com", ADMIN_ID, SECRET, () => right.client);
  const wrong = fakeAuth(SECRET, ADMIN_ID);
  const badPass = await verifyAdminPassword("admin@teste.com", ADMIN_ID, "senha-errada", () => wrong.client);
  const other = fakeAuth(SECRET, "b0000000-0000-4000-8000-0000000000bb");
  const otherUser = await verifyAdminPassword("admin@teste.com", ADMIN_ID, SECRET, () => other.client);
  const empty = await verifyAdminPassword("admin@teste.com", ADMIN_ID, "", () => right.client);
  const noEmail = await verifyAdminPassword(null, ADMIN_ID, SECRET, () => right.client);
  check(okPass && right.calls.signOut === 1, "S1 senha certa", right.calls);
  check(!badPass && wrong.calls.signOut === 0 && !otherUser && !empty && !noEmail, "S1 recusas", { badPass, otherUser, empty, noEmail });
  check(!logs.some((l) => l.includes(SECRET)), "S1 senha em log");
  ok("S1: senha do ADMIN conferida no Supabase Auth: certa → aceita (e a sessão de conferência é encerrada); errada, vazia, sem e-mail ou de OUTRO usuário → recusada; a senha não aparece em nenhum log");

  // ---------- S2: Storage — só o cache de arte exclusivo das placas excluídas ----------
  const version = {
    id: "ver-1", template_id: "tpl-1", version_number: 3, base_image_path: "tpl-1/v3.png", base_image_mime_type: "image/png",
    base_image_sha256: createHash("sha256").update("arte").digest("hex"), base_image_size_bytes: 10,
    canvas_width: 1024, canvas_height: 1536, print_width_mm: 80, print_height_mm: 120, qr_x: 312, qr_y: 520, qr_width: 400, qr_height: 400,
    qr_error_correction: "M", qr_quiet_zone: 4, qr_color: "#000000", qr_background_color: "#FFFFFF", show_public_code: true, code_x: 512, code_y: 1100,
    code_font_family: "inter-bold", code_font_size: 72, code_color: "#0d1a2a", code_align: "center", code_max_width: 600, safe_margin: 40, renderer_version: 1,
  };
  const removed: string[] = [];
  const written: string[] = [];
  const query = (rows: Record<string, unknown>[]) => {
    let r = [...rows];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => ((r = r.filter((x) => x[c] === v)), b),
      in: (c: string, vs: unknown[]) => ((r = r.filter((x) => vs.includes(x[c]))), b),
      maybeSingle: async () => ({ data: r[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: r, error: null }).then(res),
    };
    return b;
  };
  const admin = {
    from: (t: string) => query(t === "plate_batches" ? [{ id: "batch-1", template_version_id: "ver-1" }, { id: "batch-sem", template_version_id: null }] : t === "plate_template_versions" ? [version] : []),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removed.push(...paths.map((p) => `${bucket}/${p}`));
          return { data: paths.map((name) => ({ name })), error: null };
        },
        list: async () => ({ data: [], error: null }),
        exists: async () => ({ data: false, error: null }),
        download: async () => ({ data: new Blob([new Uint8Array([1])]), error: null }),
        upload: async (path: string) => (written.push(path), { data: { path }, error: null }),
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://s/${path}` }, error: null }),
      }),
    },
  } as unknown as SupabaseClient;
  const deleted = [
    { id: "p1", public_code: "A7K482", batch_id: "batch-1" },
    { id: "p2", public_code: "B4N791", batch_id: "batch-1" },
    { id: "p3", public_code: "C8P221", batch_id: "batch-sem" },
  ];
  const r = await removeDeletedPlateOutputs(admin, deleted);
  const expected = ["A7K482", "B4N791"].map((c) => `${OUTPUTS_BUCKET}/${previewPath("plates", layoutFromVersion(version as never), version.base_image_sha256, c, buildQrUrl(c))}`);
  check(r.removed === 2 && JSON.stringify(removed) === JSON.stringify(expected), "S2 removidos", { removed, expected });
  check(removed.every((p) => p.startsWith(`${OUTPUTS_BUCKET}/previews/plates/`)) && !removed.some((p) => /exports\/|plate-templates|tpl-1\/v3|landing|branding|direct/.test(p)), "S2 nada compartilhado");
  ok("S2: excluir placas remove do Storage SÓ o cache da arte individual delas (previews/plates/<chave da placa>); placa de lote sem template não tem arquivo; nada de pacotes do lote, arte base, versão de template, landing, branding ou DirectLink");

  // ---------- S3: o caminho apagado é exatamente o que a arte individual grava ----------
  try {
    await cachedRenderUrl(admin, "plates", layoutFromVersion(version as never), version as never, "A7K482", buildQrUrl("A7K482"));
  } catch {
    // a arte base simulada não é um PNG de verdade: interessa só o caminho que a função tentaria usar
  }
  const artPath = previewPath("plates", layoutFromVersion(version as never), version.base_image_sha256, "A7K482", buildQrUrl("A7K482"));
  const serviceSrc = readFileSync("src/lib/templates/service.ts", "utf8");
  const artRoute = readFileSync("src/app/api/admin/plates/[id]/art/route.ts", "utf8");
  check(serviceSrc.includes("const path = previewPath(scope, layout, version.base_image_sha256, publicCode, qrUrl);") && artRoute.includes('"plates",') && artRoute.includes("buildQrUrl(plate.public_code)") && expected[0] === `${OUTPUTS_BUCKET}/${artPath}`, "S3");
  ok("S3: o caminho removido é calculado pela MESMA função (previewPath) que a arte individual da placa usa para gravar o cache — escopo 'plates', versão do lote e URL do QR");

  // ---------- S4: rotas ----------
  const bulk = readFileSync("src/app/api/admin/plates/bulk/route.ts", "utf8");
  const ids = readFileSync("src/app/api/admin/plates/ids/route.ts", "utf8");
  const code = bulk.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check(bulk.includes("await requireAdminApi()") && ids.includes("await requireAdminApi()"), "S4 ADMIN");
  check(code.indexOf("verifyAdminPassword(") > 0 && code.indexOf("verifyAdminPassword(") < code.indexOf('"admin_plates_delete_unused"'), "S4 senha antes da exclusão");
  check(!/console\.[a-z]+\([^)]*password/i.test(code) && !/password[^\n]*NextResponse\.json|NextResponse\.json\([^)]*password/i.test(code), "S4 senha não vaza");
  check(/ids: z\.array\(z\.uuid\(\)\)\.min\(1\)\.max\(BULK_MAX\)/.test(bulk) && (code.match(/sb\.rpc\("admin_plates_/g) ?? []).length === 3, "S4 uma chamada");
  check(code.includes("auth.session.user.email") && !/body\.email|parsed\.data\.email/.test(code), "S4 e-mail da sessão");
  ok("S4: as rotas exigem ADMIN; a senha é conferida ANTES de qualquer exclusão, com o e-mail da sessão (nunca do pedido); nunca vai para log nem para a resposta; até 5000 placas viajam numa ÚNICA chamada ao banco (nada de 1 requisição por placa)");

  if (failures) {
    process.stdout.write(`${failures} falha(s)\n`);
    process.exit(1);
  }
  process.stdout.write("Ações em massa de placas OK\n");
  process.exit(0);
}
main().catch((e) => {
  process.stdout.write(`erro: ${e instanceof Error ? e.stack : e}\n`);
  process.exit(1);
});
