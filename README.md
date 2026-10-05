# Placas QR + NFC

Sistema de produção de placas físicas com QR Code e NFC. Cada placa tem identidade própria e
permanente; o destino final (Google Avaliações, WhatsApp, cardápio...) é decidido pelo backend a
cada acesso e pode mudar sem reimprimir nada.

```
1 placa = 1 public_code = 1 QR exclusivo = 1 URL NFC exclusiva

QR   https://go.meudominio.com/A7K482?src=qr
NFC  https://go.meudominio.com/A7K482?src=nfc
         │
         └─ backend consulta destination_url → 302 (nunca 301) → destino atual
```

O parâmetro `src` (`qr`, `nfc` ou qualquer outro valor, registrado como `unknown`) serve apenas
para analytics: é gravado em `redirects.source` e o acesso segue normalmente para o destino. Um
acesso **nunca** altera o estado da placa. O sistema não controla gravação nem teste físico do NFC:
ele fornece a URL NFC de cada placa, e a gravação da tag é feita fora do sistema.

Stack: Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage,
RLS) · deploy na Vercel. O renderer de produção usa `@napi-rs/canvas` (Skia).

---

## Sumário

1. [Estrutura do projeto](#estrutura-do-projeto)
2. [Configuração](#configuração)
3. [Rodando localmente](#rodando-localmente)
4. [Deploy na Vercel](#deploy-na-vercel)
5. [Roteiro de teste](#roteiro-de-teste)
6. [Operação: placas, revendedores, clientes e vendas](#operação-placas-revendedores-clientes-e-vendas)
7. [Templates e versionamento](#templates-e-versionamento)
8. [Renderer](#renderer)
9. [Exportações e processamento assíncrono](#exportações-e-processamento-assíncrono)
10. [Segurança](#segurança)
11. [Testes automatizados](#testes-automatizados)
12. [Limitações atuais](#limitações-atuais)

---

## Estrutura do projeto

```
supabase/
  migrations/           migrations incrementais (idempotentes)
  tests/                testes de comportamento do banco + stubs para Postgres puro
public/fonts/           fontes do renderer (as mesmas no navegador e no servidor)
scripts/                testes do renderer e das exportações (sem Supabase)
src/
  proxy.ts              reescrita do domínio go.* e renovação de sessão
  app/
    go/[code]/          redirect público 302
    login/ forbidden/ reseller/ auth/signout/
    admin/dashboard/    indicadores de vendas, faturamento e resumo operacional
    admin/sales/        vendas (controle interno, sem cobrança)
    admin/plates/       todas as placas: filtros, detalhe, revendedor, destino, status
    admin/templates/    lista, novo, edição + versões
    admin/batches/      lista + criação, detalhe do lote
    admin/resellers/    revendedores, cadastro, atribuição de placas
    admin/customers/    visão administrativa dos clientes
    admin/accesses/     acessos por QR Code (métrica oficial)
    admin/settings/     valores do ambiente (somente leitura)
    reseller/           painel do revendedor: início, placas, clientes
    api/admin/...       rotas ADMIN (todas checam o papel no servidor)
    api/reseller/...    rotas do revendedor (configuração de placa e clientes)
    api/cron/exports/   varredura opcional da fila
  components/           UI (editor de template, painel de exportações, tabela de placas)
  lib/
    renderer/           renderer isolado: draw.ts (puro) + server.ts (Skia)
    templates/          validação, geometria, upload seguro, serviço de versões
    exports/            fila, worker com lease, exportadores (csv, qr_zip, art_png_zip, art_pdf)
    auth/ db/ supabase/ plates/ utils/
```

## Configuração

### 1. Dependências

Node.js 20 ou superior.

```bash
npm install
```

### 2. Projeto no Supabase

Crie um projeto em https://supabase.com e copie `.env.example` para `.env.local`, preenchendo:

| Variável | Onde encontrar | Observação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings > API | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings > API | chave anon/publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings > API | **só servidor**, nunca com `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_GO_BASE_URL` | você define | local: `http://localhost:3000/go` |
| `CRON_SECRET` | `openssl rand -hex 32` | opcional, protege `/api/cron/exports` |

> **`NEXT_PUBLIC_GO_BASE_URL` faz parte da identidade física das placas.** Ele é gravado em cada QR e
> em cada tag NFC. Depois de imprimir ou gravar a primeira placa de produção, não altere esse valor.

### 3. Aplicar as migrations

Com a Supabase CLI:

```bash
npx supabase login
npx supabase init            # só se ainda não existir supabase/config.toml
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Alternativa: execute os arquivos de `supabase/migrations/` **em ordem** no SQL Editor do painel.

As migrations criam as tabelas, funções, políticas RLS e os buckets privados `plate-templates` e
`plate-outputs`. Elas usam `IF NOT EXISTS` / `CREATE OR REPLACE`, então não recriam estruturas que já
existam.

### 4. Autenticação e primeiro ADMIN

1. Em **Authentication > Sign In / Providers**, mantenha Email habilitado e **desative "Allow new users to sign up"**. Os usuários são criados pelo administrador.
2. Em **Authentication > Users > Add user**, crie seu usuário (marque *Auto Confirm User*).
3. Todo usuário nasce como `reseller`. Promova o seu a ADMIN no SQL Editor:

```sql
update public.profiles set role = 'admin' where email = 'voce@empresa.com';
```

Revendedores são cadastrados pelo painel, em **Revendedores > Novo revendedor**: o sistema cria o
acesso (e-mail e senha inicial) e o cadastro da empresa numa única operação.

## Rodando localmente

```bash
npm run dev          # http://localhost:3000
npm run typecheck    # TypeScript
npm run build        # build de produção
npm run test:renderer
npm run test:exports
```

Localmente, use `NEXT_PUBLIC_GO_BASE_URL=http://localhost:3000/go`: os QR apontam para
`http://localhost:3000/go/A7K482?src=qr`. Para escanear com o celular, use o IP da máquina na rede
(ex.: `http://192.168.0.10:3000/go`) ou um túnel HTTPS, e **gere lotes de teste** com esse valor.
Lotes de produção só devem ser gerados com o domínio definitivo.

## Deploy na Vercel

1. Importe o repositório na Vercel e cadastre as mesmas variáveis de ambiente.
2. Adicione **dois domínios ao mesmo projeto**: o do painel (ex.: `app.meudominio.com`) e o de
   redirect (ex.: `go.meudominio.com`).
3. Defina `NEXT_PUBLIC_GO_BASE_URL=https://go.meudominio.com`.

O `src/proxy.ts` reconhece o host de redirect e reescreve `/A7K482` para `/go/A7K482`. Nesse host
nada além do redirect é servido (`/admin` retorna 404).

As rotas pesadas declaram `maxDuration = 60`, compatível com todos os planos.

## Roteiro de teste

### Upload e criação de template

1. Entre como ADMIN e abra **Templates > Novo template**.
2. Preencha o nome (a chave interna é sugerida automaticamente).
3. Clique em **Escolher arquivo PNG ou JPG**. O navegador envia o arquivo direto ao Storage
   (`plate-templates/staging/…`) por URL assinada e lê as dimensões da imagem. Você não digita
   `canvas_width` nem `canvas_height`.
4. Posicione o QR e o código pelos campos numéricos ou **arrastando no preview**. As guias mostram
   a margem de segurança (ciano), a área do QR (magenta) e a área máxima do código (amarelo). Os
   alertas aparecem abaixo: módulo do QR pequeno, sobreposição, margem invadida, DPI baixo, QR
   impresso menor que 20 mm.
5. Clique em **Gerar prévia fiel**. O servidor valida a arte (tipo real pelos bytes, extensão,
   tamanho, dimensões, JPG em CMYK ou com rotação EXIF) e renderiza com o renderer de produção.
6. Clique em **Criar template**. A arte é copiada para `plate-templates/{template_id}/{sha256}.png`
   e a v1 é criada.

Para testar a validação, tente enviar um arquivo `.png` que na verdade é um JPG ou texto, uma imagem
maior que 8000 px ou um JPG exportado em CMYK: todos são recusados com mensagem específica.

### Edição e versionamento

1. Abra o template e mude a posição do QR. Enquanto a versão atual não foi usada em nenhum lote, o
   aviso diz que as alterações são salvas nela mesma.
2. Gere um lote com esse template (próxima seção) e volte ao template. Agora o aviso informa que a
   versão está bloqueada. Salve uma alteração: é criada a v2, e o lote continua apontando para a v1.
3. Em **Versões**, use **Prévia fiel** em qualquer versão (inclusive bloqueadas) e **Usar como base**
   para carregar um layout antigo no editor. Salvar cria uma nova versão com ele.

### Geração de lote

1. Em **Lotes**, preencha nome (`Lote Setembro 2026`), quantidade (1 a 1000) e template.
2. Clique em **Gerar lote**. Numa única transação o banco trava a versão atual do template, cria o
   lote e gera os códigos exclusivos.
3. Teste clique duplo e request duplicada: o formulário envia uma `idempotency_key`, e o banco
   devolve o mesmo lote. Para reproduzir pela API, envie o mesmo corpo duas vezes:

```bash
curl -X POST http://localhost:3000/api/admin/batches \
  -H "Content-Type: application/json" -H "Cookie: <cookie de sessão do admin>" \
  -d '{"name":"Teste","quantity":10,"template_id":"<uuid>","idempotency_key":"<o mesmo uuid nas duas vezes>"}'
```

### Validar o QR

1. Na tela do lote, use **Ver arte** numa placa ou **Baixar QR Codes**.
2. Escaneie o QR. Sem destino ativo, abre a página "Placa ainda não ativada" mostrando o
   código — isso confirma que o QR está correto.
3. Defina um destino em **Placas > (placa) > Destino** e clique em **Salvar destino** (placas
   atribuídas a um revendedor são ativadas automaticamente na primeira configuração válida; nas
   demais, use **Ativar**). Escaneie de novo.

4. Confira que o redirect é 302 e não fica em cache:

```bash
curl -sI "http://localhost:3000/go/A7K482?src=qr"
# HTTP/1.1 302 Found
# location: https://www.google.com
# cache-control: no-store, no-cache, must-revalidate, max-age=0
```

5. Troque o destino e acesse de novo: o mesmo QR vai para o novo destino. Cada acesso é
   registrado em `public.redirects` com `source = 'qr'`.

### Validar o NFC

1. Na tabela do lote, clique em **Copiar URL NFC** (`…/A7K482?src=nfc`). A mesma URL está na coluna
   `nfc_url` do CSV e dos manifests.
2. Grave a URL na tag com um app como NFC Tools (registro do tipo URL/URI) e bloqueie a tag se
   desejar. A gravação acontece fora do sistema; não há status de NFC para marcar.
3. Aproxime o celular da tag: o comportamento é idêntico ao do QR (302 para o destino ativo, ou a
   página "Placa ainda não ativada"). O acesso é registrado em `public.redirects` com
   `source = 'nfc'`. Esse registro serve só como histórico: **o NFC não entra nas métricas
   oficiais** (veja [Acessos: somente QR Code](#acessos-somente-qr-code)):

```sql
select r.source, r.created_at from public.redirects r
join public.plates p on p.id = r.plate_id
where p.public_code = 'A7K482' order by r.created_at desc;
```

### Gerar as artes

1. Na tela do lote, clique em **Gerar artes**. O botão e a lista mostram **Gerando...** (na fila),
   **Processando...** com "N de M placas", depois **Concluído** ou **Erro**.
2. Clique em **Baixar artes**: `Lote-Setembro-2026.zip` com `A7K482.png`, `P8M392.png`, … e
   `manifest.csv` (`public_code, qr_url, nfc_url, filename`).
3. Se o ZIP passar de `EXPORT_PART_MAX_MB` (45 MB), ele é dividido em
   `Lote-Setembro-2026-parte-01.zip`, `-parte-02.zip`… (cada um com seu manifest) e é gerado também
   `Lote-Setembro-2026-manifest.csv` completo, com a coluna `zip_file`.
4. **Exportar CSV** e **Baixar QR Codes** (PNG 1024 px + SVG por placa) seguem o mesmo fluxo e
   baixam sozinhos quando ficam prontos.

## Operação: placas, revendedores, clientes e vendas

### Status da placa e redirect

Fluxo principal: **DISPONÍVEL → RESERVADA → ATIVA**. Os valores internos do banco não mudaram;
só os rótulos do painel ADMIN.

| Status (banco) | No painel | Significado | Redireciona? |
|---|---|---|---|
| `in_stock` | Disponível | em estoque, sem revendedor e sem venda; pode entrar numa nova venda | não |
| `assigned` | Reservada | vendida/atribuída ao revendedor, ainda não ativada; não pode ser atribuída de novo | não |
| `active` | Ativa | configurada e no ar | **sim**, se o destino for uma URL http(s) válida |
| `inactive` | Inativa | pausada pelo revendedor ou pelo ADMIN | não ("Placa desativada") |
| `blocked` | Bloqueada | bloqueio administrativo (só o ADMIN define e retira) | não ("Placa desativada") |

Na visão do revendedor, `assigned` continua aparecendo como "Disponível" (pronta para ele configurar).

Todo acesso é registrado em `redirects` com a origem (`qr`, `nfc` ou `unknown`), inclusive quando não
redireciona. O acesso nunca altera a placa; só atualiza os contadores `access_count` e
`last_access_at`.

### Fluxo do revendedor

1. O ADMIN registra a venda (**Vendas > Nova venda**): as placas ficam reservadas para o revendedor
   na mesma operação (veja [Vendas](#vendas)). Para casos sem venda (reposição, cortesia, ajuste)
   continua existindo a **atribuição avulsa** em **Revendedores > (revendedor)**.
2. O revendedor entra em `/login` e vê apenas as placas e os clientes dele.
3. Em **Placas > (placa)**, escolhe ou cadastra o cliente, o tipo de destino e o link, e clica em
   **Salvar**. **Na primeira configuração válida a placa passa de ASSIGNED para ACTIVE
   automaticamente**, sem outro clique.
4. Depois ele alterna **Desativar placa** / **Ativar placa** (ACTIVE ↔ INACTIVE). Salvar uma placa
   inativa não a reativa. Remover o destino de uma placa ativa a tira do ar (volta para ASSIGNED).

O revendedor **não** tem UPDATE na tabela `plates`: tudo passa pela RPC `configure_reseller_plate`,
que valida no banco usuário autenticado, ativo e RESELLER; placa dele; cliente dele; tipo permitido;
URL http(s) válida; transição de status permitida; e placa não bloqueada. Ele não consegue alterar
`public_code`, `reseller_id`, `batch_id`, nem o lote ou template.

### Ações do ADMIN na placa

Em **Placas > (placa)**: atribuir, trocar ou remover o revendedor; editar cliente e destino; ativar,
desativar, bloquear e desbloquear.

- **Placa de uma venda**: enquanto pertence a uma venda válida, o revendedor não pode ser trocado nem
  removido (nem pela atribuição avulsa, nem por SQL). Para devolvê-la ao estoque, cancele a venda.
- **Trocar ou remover o revendedor** apaga cliente e destino, porque o cliente pertence ao revendedor
  anterior. A placa sai do ar até ser configurada de novo.
- **Histórico**: toda mudança de `reseller_id` fecha a atribuição anterior e abre uma nova em
  `plate_assignments`, por trigger. Isso vale até para um UPDATE manual via SQL.
- **Desbloquear**: a placa volta para `active` se tiver destino; senão, para `assigned` ou
  `in_stock`.
- **Cliente**: o banco recusa cliente de outro revendedor, inclusive para o ADMIN.

### Vendas

**Vendas** é um controle administrativo interno (tabelas `orders`, `order_items` e `order_plates`).
Não há gateway, checkout, PIX, boleto, cartão, webhook nem cobrança.

**Registrar a venda já reserva as placas.** Em **Nova venda** o ADMIN informa revendedor,
quantidade, preço, desconto, status, observação e a forma de seleção:

- **Automática**: o sistema pega as N placas disponíveis mais antigas (opcionalmente de um lote).
- **Manual**: lista só placas realmente disponíveis (código, lote, template, status) e exige
  selecionar exatamente a quantidade da venda.

A RPC `create_sale_with_plates` faz tudo numa única transação: cria a venda (reutilizando
`create_order`), vincula as placas à venda (`order_plates`) e ao revendedor, muda o status para
RESERVADA e grava o histórico (`plate_assignments.order_id`). Se qualquer etapa falhar, nada fica
gravado. Sem estoque suficiente a venda é recusada com "Existem apenas N placas disponíveis.".
O formulário envia uma `idempotency_key`: clique duplo ou retry devolvem a mesma venda sem reservar
placas de novo.

**Concorrência.** A mesma placa nunca fica em duas vendas válidas:

1. A seleção manual trava as placas escolhidas (`FOR UPDATE`, em ordem estável) e confere o estado
   depois do lock: quem chega depois espera e é recusado se a placa já foi reservada.
2. A automática usa `FOR UPDATE SKIP LOCKED`: vendas simultâneas recebem placas diferentes.
3. O índice único parcial `order_plates_one_active_idx` permite só um vínculo ativo por placa. É a
   última barreira, independente da aplicação.
4. Triggers recusam trocar o revendedor de uma placa vinculada e cancelar por UPDATE direto uma venda
   com placas.

**Status da venda.** Pendente, Pago ou Cancelado, marcados manualmente (pendente → pago ou cancelado;
pago → cancelado). **Pago** serve apenas para o faturamento do dashboard.

**Cancelamento** (`cancel_order`; `set_order_status(..., 'cancelled')` usa a mesma regra):

- Placas ainda só **RESERVADAS** voltam para **DISPONÍVEL**: saem do revendedor, perdem cliente e
  destino, o vínculo com a venda é encerrado (`returned_to_stock`) e a atribuição é fechada com
  `ended_reason = 'order_cancelled'`. A placa física volta a ser vendável.
- Se alguma placa estiver **ATIVA**, inativa ou bloqueada, o cancelamento é **bloqueado** e a
  mensagem lista essas placas. Nada é alterado.
- Ação administrativa específica, na página da venda: **Cancelar e manter placas em uso com o
  revendedor** (confirmação digitando o número da venda). As reservadas voltam ao estoque; as em uso
  continuam com o mesmo revendedor, intactas, e deixam de pertencer à venda (`kept_with_reseller`).
  Uma placa ativa nunca vai para o estoque por esse caminho.

**Detalhe da venda**: revendedor, quantidade, cada placa com link para a página dela, o status atual,
o lote, o template, a situação na venda e o histórico (registro, pagamento, cancelamento).

Vendas registradas antes desta versão continuam válidas, só não têm placas vinculadas.

### Dashboard

Os números vêm das funções do banco, nunca de dados fictícios:

- **Faturamento**: `SUM(orders.total)` das vendas pagas no período, pela data em que foram marcadas
  como pagas.
- **Vendas realizadas**: quantidade de vendas pagas.
- **Ticket médio**: faturamento ÷ vendas.
- **Placas vendidas**: soma das quantidades dos itens de placas das vendas pagas.
- **Resumo operacional**: situação atual das placas, independente do período.

Os filtros (Hoje, 7 dias, 30 dias, Este mês, Este ano) usam o fuso de São Paulo. Os acessos por QR
Code ficam em **Acessos**, fora da home.

O gráfico de faturamento (ADMIN e revendedor) tem três apresentações, sem mudar nenhum cálculo:
nenhum período com faturamento → estado vazio com a linha de períodos; um único período → destaque
do valor e do período, com o aviso "Ainda há poucos dados para formar uma tendência."; dois ou mais →
gráfico de barras normal.

### Acessos: somente QR Code

Decisão de produto: o NFC continua **funcionando** (URL NFC, `/go/[code]?src=nfc`, redirect e o
registro `redirects.source = 'nfc'`), mas **não faz parte das métricas oficiais**, no ADMIN nem no
revendedor. Isso vale no banco, não só na tela:

- `plates.qr_access_count` / `last_qr_access_at` são o contador oficial (preenchidos a partir do log
  na migration 015). `access_count` continua existindo como total histórico de todas as origens, mas
  nenhuma tela o exibe.
- `reseller_dashboard_metrics`, `admin_reseller_stats` e `admin_dashboard_metrics` devolvem
  `accesses` só de QR. `reseller_qr_access_by_plate` e `admin_qr_access_by_plate` agregam por placa
  no banco.
- Nenhum registro de `redirects` foi apagado ou alterado: o histórico NFC permanece.

## Templates e versionamento

```
plate_templates            identidade: nome, chave, descrição, ativo       (mutável)
plate_template_versions    arte + geometria + renderer_version             (imutável após locked_at)
plate_batches              template_version_id da versão EXATA usada        (imutável)
```

- **Criar template** gera a v1 (`create_plate_template`).
- **Salvar layout** chama `save_template_layout`, que trava o template (`FOR UPDATE`) e decide:
  - layout idêntico ao atual → nada muda;
  - versão atual sem `locked_at` → edita no lugar;
  - versão atual bloqueada → cria a versão N+1 e a torna atual.
- **Criar lote** (`create_plate_batch`) trava o mesmo template, grava a versão atual no lote e um
  trigger preenche `locked_at`.
- Um trigger no banco recusa `UPDATE`/`DELETE` em versões bloqueadas, até de ADMIN. Outro recusa a
  troca da versão de um lote e a alteração de `public_code`.
- As artes ficam em `plate-templates/{template_id}/{sha256}.{ext}`, gravadas com `upsert: false`.
  Não há política de UPDATE no Storage. Ao carregar uma arte de versão, o servidor confere o sha256.
- Nome, descrição e ativo/inativo não afetam a arte, então não geram versão. Template inativo não
  aparece na criação de lotes; lotes antigos não são afetados.

Campos de cada versão: `base_image_path`, `base_image_mime_type`, `base_image_sha256`,
`base_image_size_bytes`, `canvas_width`, `canvas_height`, `print_width_mm`, `print_height_mm`,
`qr_x`, `qr_y`, `qr_width`, `qr_height`, `qr_error_correction`, `qr_quiet_zone`, `qr_color`,
`qr_background_color`, `show_public_code`, `code_x`, `code_y`, `code_font_family`,
`code_font_size`, `code_color`, `code_align`, `code_max_width`, `safe_margin`,
`renderer_version`, `locked_at`, `created_at`, `updated_at`.

Convenções de coordenadas (px da arte original):
- a caixa do QR **inclui** a zona de silêncio e é pintada com a cor de fundo do QR;
- `code_x` é a âncora conforme `code_align`; `code_y` é o centro vertical do texto (pela altura de
  maiúscula, igual para todos os códigos do lote);
- se o texto ultrapassar `code_max_width`, a fonte é reduzida (nunca quebra linha).

## Renderer

```
src/lib/renderer/
  draw.ts     drawPlate(ctx, { layout, baseImage, publicCode, qrUrl })   ← puro, sem React/DOM/Node
  qr.ts       matriz do QR e geometria (módulos com tamanho inteiro em px)
  fonts.ts    registro fechado de fontes (public/fonts)
  server.ts   renderPlate(layout, imagem, publicCode, qrUrl) → PNG  (Skia)
```

- O **preview rápido** chama o mesmo `drawPlate` sobre o canvas do navegador. A **prévia fiel**, a
  arte avulsa por placa e o ZIP do lote chamam `server.ts`. Não existe lógica de desenho nos
  componentes React.
- É determinístico: as mesmas entradas geram os mesmos bytes (verificado em `npm run test:renderer`).
- Cada módulo do QR tem tamanho inteiro em pixels, para bordas nítidas; a sobra é centralizada.
- `renderer_version` fica gravado em cada versão. Qualquer mudança de comportamento no desenho deve
  criar a versão 2 do renderer, mantendo a 1, para que lotes antigos sejam reimpressos iguais.
- Para adicionar uma fonte, coloque o `.ttf` em `public/fonts` e registre em `fonts.ts`. Nunca troque
  um arquivo já usado por versões bloqueadas.

## Exportações e processamento assíncrono

`batch_exports` é ao mesmo tempo o registro das exportações e a fila de jobs.

| kind | Resultado |
|---|---|
| `csv` | `{Lote}.csv`, uma linha por placa |
| `qr_zip` | `{Lote}-QR-Codes.zip`, com PNG e SVG por placa + manifest |
| `art_png_zip` | `{Lote}.zip`, com a arte final por placa + `manifest.csv` |
| `art_pdf` | reservado: tipo e fila prontos, exportador ainda não implementado |

**Estratégia.** Nenhuma requisição do usuário fica esperando a geração inteira:

1. `POST /api/admin/batches/[id]/exports` grava o job como `pending` e responde na hora. Um índice
   único impede dois jobs ativos do mesmo tipo no mesmo lote (clique duplo devolve o job existente).
2. Depois da resposta, `after()` (waitUntil na Vercel) executa o worker.
3. O worker reivindica o job com `claim_batch_export`, que devolve um `lease_token` exclusivo de 90 s.
4. Ele processa **uma parte por vez** (um ZIP de até ~45 MB) e, após cada parte, grava no banco
   `next_offset`, `files` e o progresso, renovando o lease. Só o dono do lease consegue gravar.
5. Ao esgotar o orçamento de tempo (`EXPORT_TIME_BUDGET_MS`, 45 s), ele libera o lease e para. A
   próxima execução continua do `next_offset` sem refazer partes já enviadas.
6. Quem aciona as próximas execuções:
   - o **polling da tela do lote** (a cada 2,5 s, enquanto há job ativo), que reagenda jobs parados;
   - opcionalmente, um **cron** chamando `GET /api/cron/exports`.
7. Em caso de erro, o job volta para a fila; após 3 tentativas fica `failed` com `error_message`.

**Cron opcional** (para concluir exportações sem a tela aberta). A Vercel Hobby só permite cron
diário. Opções:

- Vercel Pro: crie `vercel.json` com

```json
{ "crons": [{ "path": "/api/cron/exports", "schedule": "* * * * *" }] }
```

  e defina `CRON_SECRET` (a Vercel envia o cabeçalho `Authorization` automaticamente).

- Supabase (qualquer plano), com as extensões `pg_cron` e `pg_net` habilitadas:

```sql
select cron.schedule(
  'placas-exports',
  '* * * * *',
  $$ select net.http_get(
       url := 'https://app.meudominio.com/api/cron/exports',
       headers := jsonb_build_object('Authorization', 'Bearer SEU_CRON_SECRET')
     ); $$
);
```

## Segurança

A autorização é verificada em camadas independentes:

| Camada | O que faz |
|---|---|
| `proxy.ts` | sem sessão, `/admin` e `/reseller` vão para `/login` |
| `app/admin/layout.tsx` | quem não é ADMIN vai para `/forbidden` |
| rotas `/api/admin/*` | `requireAdminApi()`: 401 sem sessão, **403 para RESELLER** |
| RPCs no banco | `is_admin()` dentro de cada função; erro 42501 |
| RLS | templates, versões, lotes e exportações só para ADMIN; RESELLER lê só as próprias placas |
| Storage | buckets privados; downloads por URL assinada de curta duração |

- A service role só é usada no servidor, depois da checagem de ADMIN, ou no worker e no cron.
- O redirect público usa a chave anon e a função `resolve_plate_redirect`. A tabela `plates` não é
  legível por `anon`.
- `destination_url` só aceita `http(s)://` (constraint + verificação no redirect).
- O login só aceita `next` com caminho interno (sem open redirect).
- O CSV neutraliza células que começam com `= + - @` (injeção de fórmula).

## Ciclo do lote: ativo / quarentena / arquivado

Lote não se exclui — os QRs podem já estar impressos em placas físicas. O que existe é um ciclo
**operacional** (`plate_batches.lifecycle_status`), separado de qualquer status técnico de geração
ou exportação. Todo lote nasce `active`.

| Estado | O que significa | Condição para entrar |
|---|---|---|
| `active` | Participa de estoque, vendas e atribuições | padrão |
| `quarantine` | Fora de circulação; nada pode ser reservado | **todas** as placas do lote totalmente livres |
| `archived` | Organização histórica | **zero** placas disponíveis em estoque |

"Totalmente livre" (`plate_is_operationally_free`) = em estoque, sem revendedor, sem cliente, sem
destino, sem reserva de venda ativa e sem atribuição aberta. Histórico de venda **cancelada** não
impede a quarentena: o que conta é o estado atual.

Nada é apagado em nenhuma transição — QR, `public_code`, placas, destinos, revendedor, cliente,
redirects e histórico ficam exatamente como estavam. Arquivar um lote **não** afeta o painel do
revendedor: placa já entregue continua configurável, ativável e redirecionando.

A proteção é do banco, não da interface:

- `set_batch_lifecycle_status()` trava o lote e **todas as placas** com `FOR UPDATE` em ordem de
  `id` — a mesma ordem da venda manual, então não há deadlock;
- o trigger `guard_plate_batch_lifecycle` barra qualquer caminho que tire placa do estoque de um
  lote fora de circulação, inclusive `UPDATE` manual;
- `admin_available_stock`, `admin_available_plates`, `create_sale_with_plates` e
  `assign_plates_to_reseller` filtram por `lifecycle_status = 'active'`.

`batch_lifecycle_events` guarda o histórico (estado anterior, novo, motivo, usuário, data) e é
append-only.

**Concorrência venda × quarentena.** Se a venda chega primeiro, ela segura as placas e a quarentena
é recusada. Se a quarentena chega primeiro, a venda manual espera e é barrada, e a automática
(`SKIP LOCKED`) nem enxerga aquelas placas. Não existe estado intermediário.

## Vendas do revendedor (financeiro privado)

Duas camadas comerciais que não se misturam:

| Tabela | Quem vende | Quem vê |
|---|---|---|
| `orders` | ADMIN → revendedor | ADMIN |
| `reseller_sales` | revendedor → cliente final | **só o próprio revendedor** |

O ADMIN da aplicação não tem acesso ao financeiro do revendedor, e isso não depende do código:

- não existe policy de leitura para `is_admin()` em `reseller_sales`/`reseller_sale_items`;
- os privilégios de tabela são revogados **até de `service_role`** — um `createAdminClient()` em
  qualquer rota não contorna a RLS, porque nem privilégio há;
- as RPCs são `SECURITY DEFINER` e sempre se amarram a `current_reseller_id()`, derivado de
  `auth.uid()`.

Regras de venda: só placas do próprio revendedor, no estado interno `assigned`, fora de outra venda
não cancelada. O índice único parcial `reseller_sale_items_one_active_idx` é a última barreira —
a mesma placa nunca entra em duas vendas ativas.

**A venda já vincula as placas ao cliente** (migration 017). Numa única transação,
`create_reseller_sale` cria a venda e os itens e grava `plates.customer_id` com o cliente escolhido.
O revendedor é mantido e a placa continua **RESERVADA**: sem destino e sem ativação. Se qualquer passo
falhar, nada fica gravado. "Sem cliente" continua permitido e deixa `customer_id` nulo. O cliente é
validado no banco (mesmo revendedor), assim como a placa (dele, reservada, sem destino e fora de outra
venda ativa).

Nova venda, na ordem do atendimento: **1. Cliente** (com **+ Novo cliente**, que abre um modal e já
seleciona o cliente criado, sem perder o que foi preenchido) → **2. Placas** (liberadas depois de
escolher o cliente ou "Sem cliente") → **3. Valor, status, data e observação**. Depois de salvar:

- **1 placa**: abre direto a configuração da placa, com o cliente já preenchido. Salvar o destino ativa.
- **Várias placas**: abre a venda, com **Configurar placas da venda** ("1 de 3 configuradas") e um
  botão Configurar / Ver placa por placa.

**Cancelamento.** O vínculo com o cliente é desfeito **somente** quando foi a própria venda que o
criou (`reseller_sale_items.customer_linked`) e a placa continua só reservada: status `assigned`, sem
destino, com o mesmo revendedor e ainda com o cliente da venda. Se a placa já tinha outro cliente antes
da venda, ele é restaurado. A placa volta a ser elegível para outra venda do mesmo revendedor. Se a
placa já estiver ativa, inativa, bloqueada ou configurada, cancelar **não** remove cliente, não apaga
destino, não muda revendedor, não devolve ao ADMIN e não desliga o QR: só o registro financeiro sai
dos indicadores. Uma ativação simultânea ao cancelamento é tratada por lock de linha: o cancelamento
espera e respeita a placa ativada. Vendas registradas antes desta versão cancelam como antes, sem
tocar no cliente da placa.

O ADMIN continua vendo a relação operacional placa → revendedor → cliente, mas não as vendas nem os
valores do revendedor.

Indicadores do painel (`reseller_sales_metrics`) consideram **apenas vendas pagas**; sem vendas no
período, o ticket médio é `R$ 0,00`. Nada disso altera o dashboard financeiro do ADMIN, que
continua somando só `orders`.

### Preço itemizado da venda (valor unitário + desconto)

Na nova venda, o revendedor informa o **valor unitário** e o **desconto (R$)**. O subtotal e o total
são calculados e exibidos em tempo real, e o **total é só leitura**:

`total = placas selecionadas × valor unitário − desconto`

- **Recálculo no servidor:** a rota `POST /api/reseller/sales` chama a RPC
  `create_reseller_sale_priced` (migration `20261003120000_reseller_sale_pricing.sql`).
  - Ela recebe apenas as placas, o unitário e o desconto, **em centavos (inteiros)**.
  - A quantidade é contada pelo banco a partir das placas realmente vendidas.
  - O subtotal e o total são recalculados ali. Um total enviado pelo navegador é descartado (o
    schema da rota nem tem esse campo).
  - A venda propriamente dita continua sendo criada pela RPC existente `create_reseller_sale`.
- **Validação:** desconto negativo, desconto maior que o subtotal, unitário inválido e total
  negativo são recusados no banco. A tela também bloqueia o envio.
- **Histórico:** a tabela `reseller_sale_pricing` guarda uma linha por venda nova (quantidade,
  unitário, subtotal, desconto e total, em centavos).
  - A linha é imutável.
  - A RLS libera a leitura só para o revendedor dono; o ADMIN não tem acesso.
  - Vendas antigas não têm linha e continuam exibidas como antes.
- **Métricas:** faturamento e ticket médio continuam usando o valor final da venda (já com
  desconto) e só vendas pagas.

## Clientes: nome de exibição e quarentena

**Nome de exibição.** O revendedor trabalha com estabelecimentos, então a empresa/comércio é o nome
principal do cliente nas telas operacionais: Nova Venda, seletores, Acessos, Minhas Placas, detalhe da
placa, vendas, Clientes e telas do ADMIN. Sem empresa, usa o nome da pessoa. A regra é única:
`getCustomerDisplayName()` em `src/lib/customers.ts`, espelhada no banco por
`public.customer_display_name()`, usada pelas RPCs que devolvem `customer_name`. É só apresentação: o
cadastro continua com **Nome / responsável** e **Empresa / comércio** separados, e a busca encontra
pelos dois.

**Quarentena (sem exclusão física).** O botão **Excluir** move o cliente para a Quarentena
(`customers.archived_at`, `archived_by`, `archive_reason`), pelas RPCs `quarantine_customer` e
`restore_customer`, amarradas a `current_reseller_id()`. O cliente em quarentena sai da lista e dos
seletores de venda e de placa. Vendas, placas, acessos e valores em que ele já aparece continuam
intactos e continuam mostrando o nome dele. **Restaurar** devolve o cliente às listas.

A regra é garantida no banco, não só na tela:

- `DELETE` em `customers` é recusado por trigger, mesmo com privilégio total, e o privilégio de
  `DELETE` foi revogado de `anon` e `authenticated`.
- As colunas de quarentena só mudam pelas duas RPCs.
- Nova venda (`reseller_sales`) e nova atribuição de placa (`plates.customer_id`) com cliente em
  quarentena são recusadas. O vínculo que já existe continua, e cancelar uma venda ainda restaura o
  cliente anterior da placa.
- A antiga rota `DELETE /api/reseller/customers/[id]` agora faz a quarentena.

A tela Clientes tem os filtros **Ativos | Quarentena | Todos**.

## Tela de login e personalização

`/login` tem o visual DirectPlaca: fundo preto/navy, card escuro com borda azul luminosa, campos
escuros e botão azul → ciano. A autenticação é a mesma (`signIn` em `src/app/login/actions.ts`). Não
há "Lembrar de mim" nem "Esqueci minha senha", porque não existem como função. O mostrar/ocultar
senha é funcional.

Em **Admin → Configurações → Personalização da tela de login** é possível alterar, sem novo deploy:

- banner / plano de fundo;
- logo do card;
- nome da marca, com a opção "logo + nome" ou "somente logo";
- texto de acesso, título e subtítulo.

A tela tem prévia ao vivo, **Visualizar prévia** (tela inteira), **Salvar alterações** e **Restaurar
padrão**.

- **Dados:** a tabela `branding_settings` tem uma linha só. Um campo nulo usa o padrão definido em
  `src/lib/branding/defaults.ts`.
- **Leitura pública:** a tela de login lê apenas a RPC `public_login_branding()`, que devolve só textos
  e caminhos das imagens. A tabela não é legível por `anon` nem pelo revendedor.
- **Escrita:** apenas por ADMIN, via `admin_save_branding` e `admin_reset_branding`. O banco também
  confere que a imagem existe no bucket e que o caminho segue o padrão gerado pelo upload.
- **Storage:** o bucket `branding` é **público só para leitura** das imagens. O upload é permitido
  apenas a ADMIN autenticado, nas pastas `logo/` e `banner/`, em PNG, JPG ou WEBP até 4 MB. Não há
  policy de UPDATE nem de DELETE.
- **Upload** (`POST /api/admin/branding/upload`):
  - usa a sessão do ADMIN, sem service role;
  - identifica o tipo pelos bytes do arquivo; **SVG é recusado**;
  - limites: logo até 1 MB e 2048 px; banner até 4 MB, entre 800×400 e 6000 px;
  - cada envio ganha um nome único (`<tipo>/<uuid>.<ext>`), então não há problema de cache, e
    arquivos antigos não são apagados.
- **Fallback:** sem configuração, com o Supabase fora do ar, com erro ou sem resposta em 2,5 s, o
  login abre com o padrão DirectPlaca. O formulário nunca faz parte do banner.

### Responsividade do card de login

Só o card do formulário se adapta; o banner e o branding não mudam. Os tamanhos vêm de tokens
`--lg-*` definidos em `.login-root` (`globals.css`), sem `zoom` nem `transform`:

- **Monitor grande:** o visual aprovado.
- **Notebook** (a partir de 1024 px de largura, com pouca altura: 1440×900, 1366×768, 1280×720,
  1024×768): card mais estreito e mais denso (logo, títulos, campos, botão e espaçamentos), para o
  formulário inteiro caber na tela sem rolagem.
- **Celular:** card centralizado com margens laterais e campos de 44 px ou mais. Em telas baixas
  (ex.: 320×568) o espaçamento vertical é reduzido.

Teste: `scripts/e2e/login-responsive-e2e.mjs` (notebooks e celulares de 320 a 430 px).

## Design system (ADMIN e revendedor)

ADMIN e revendedor usam a mesma identidade DirectPlaca; cada painel mantém os próprios módulos, dados
e permissões. A mudança é só de apresentação: nenhuma regra, consulta ou migration foi alterada.

- **Tokens** (`src/app/globals.css`, bloco `@theme`):
  - navy da sidebar `--color-navy` (#0d1a2a);
  - azul DirectPlaca `--color-mat` (#0b63de), para ação principal, item ativo, links e foco;
  - fundo `--color-paper` (#f5f8fb), textos `--color-ink` / `--color-ink-soft` e bordas `--color-line`;
  - verde, âmbar e vermelho só para status.

  `--color-mat` é o nome histórico do token primário e continua sendo o usado em todo o código.
- **Tipografia:** Inter (`@fontsource-variable/inter`, servida pelo próprio app, sem Google Fonts). O
  login mantém Archivo (fixado em `.login-root`) e não mudou.
- **Logo:** `public/brand/directplaca-logo.png`, usada só por `BrandLogo`
  (`src/components/shell/BrandLogo.tsx`). Para trocar a logo, substitua o arquivo com o mesmo nome. A
  arte tem fundo navy e é exibida sobre o navy da sidebar.
- **Estrutura** (`src/components/shell/AppShell.tsx`):
  - desktop, a partir de 1024 px: sidebar navy com logo, bloco do usuário, menu com ícones e item ativo
    em azul, mais uma barra superior;
  - abaixo disso: barra navy com a logo e gaveta com o mesmo menu. A gaveta recebe o foco, fecha com
    Esc e devolve o foco ao botão.

  `AdminShell` (`components/admin/AdminNav.tsx`) e `ResellerShell` (`components/reseller/ResellerNav.tsx`)
  definem os menus.
- **Componentes** (`src/components/ui/kit.tsx`, `primitives.tsx`, `icons.tsx`):
  - `PageTitle` / `PageHeader`, `StatCard` (KPI), `Panel`, `Segmented` (filtros), `SearchForm`,
    `EmptyNote`, `Feedback` e `InfoNote`;
  - `StatusBadge` e `Tone`, com badges suaves: Disponível azul, Reservada âmbar, Ativa verde, Inativa
    cinza, Bloqueada vermelha;
  - um único conjunto de ícones.

  As classes `.card`, `.btn`, `.btn-primary`, `.btn-ghost`, `.input`, `.label`/`.field-label`,
  `.data-table`, `.badge-*` e `.icon-tile` padronizam as demais telas.
- **Densidade responsiva** (tokens `--ds-*` em `globals.css`, sem `zoom` nem `transform`). Os
  componentes compartilhados leem os tokens, então todas as telas herdam:

  | Faixa | Largura | Sidebar | Características |
  |---|---|---|---|
  | Celular | < 640 px | gaveta | uma coluna, alvos de toque de 40 px ou mais |
  | Tablet | 640–1023 px | gaveta | 2 colunas de KPIs |
  | **Notebook (compacto)** | 1024–1439 px | 224 px | títulos, KPIs, paddings e gaps reduzidos |
  | Grande | 1440–1599 px | 264 px | valores do visual aprovado |
  | Grande | ≥ 1600 px | 288 px | idêntico ao visual aprovado |

  - **Grade de KPIs** (`KpiGrid`): 4, 2 ou 1 colunas pela **largura real do conteúdo** (container
    query), independentemente da sidebar.
  - **Card de KPI:** o valor se ajusta à largura do card; se o card ficar estreito, o valor ocupa a
    largura inteira, sem corte nem reticências.
  - **Filtros** (`Segmented`): quebram linha em vez de rolar.
  - **Tabelas:** rolam dentro do próprio componente.
  - **Teste:** `scripts/e2e/responsive-e2e.mjs` mede as 18 telas em 9 resoluções (1920×1080 a
    360×800), inclusive com valores financeiros longos.
- **Gráficos:**
  - **Faturamento do ADMIN:** linha com área, em três estados (sem dados, um período, tendência), com
    dica ao passar o mouse. A granularidade aparece como etiqueta porque é automática pelo período.
  - **Acessos por QR Code do revendedor:** barras diárias dos últimos 30 dias
    (`src/lib/db/qr-series.ts`). Só conta `source = 'qr'` e é filtrado pela RLS. Não exigiu
    migration: agrega até 10 mil leituras no servidor, e o total exibido é sempre exato.

## Avaliação Google: link curto DirectPlaca (`/r/<código>`, pensado para NFC)

A geração da Avaliação Google continua igual: pesquisa ou link, candidatos, seleção, resolução de
share.google e Places API. O que muda é o resultado. Ao concluir, a DirectPlaca guarda o link
oficial e entrega um **link curto próprio**.

- **Formato:** `<origem de NEXT_PUBLIC_GO_BASE_URL>/r/<7 caracteres>`.
  - Exemplo: `https://go.directplaca.com/r/A7K4829` = 36 bytes.
  - A tela mostra o tamanho real em bytes UTF-8 e avisa (sem bloquear) acima de 40.
  - O tamanho é só do endereço; o registro NDEF tem um pequeno acréscimo do formato.
- **Banco** (migration `20261009120000_directlab_review_short_links.sql`):
  - Tabela `directlab_review_links`:
    - código único e imutável;
    - um código por dono + Place ID;
    - dono com `ON DELETE SET NULL` (link já entregue não quebra).
  - `directlab_finalize_generation` cobra a utilização e cria/reaproveita o link na mesma
    transação: se o link falhar, nada é cobrado.
  - `public_review_link(código)` devolve só o destino. Não há leitura direta da tabela.
- **Destino:** só links de avaliação do Google, validados no banco e no servidor:
  - `google.com/maps/…`;
  - `search.google.com/local/writereview`;
  - `g.page/r/…`.

  Recusa `google.com/url`, `..`, http, `javascript:`, `data:`, `file:` e outros hosts. Não é um
  encurtador genérico.
- **Rota pública** `src/app/r/[code]/route.ts`:
  - consulta só o código e responde 302 (nunca 301), com `no-store`;
  - inexistente → 404; banco fora → 503;
  - não chama o Google, não consome cota e não registra acessos;
  - o `proxy.ts` libera `/r/<7>` sem sessão, inclusive no domínio `go`.
- **"Usar em uma placa":** inalterado. A placa recebe o link original do Google (`/go/<código>`
  → Google, sem redirect duplo).
- **Sem a migration aplicada:** a ferramenta segue como antes, entregando só o link do Google.
- **Testes:**
  - `npm run test:directlab-shortlink` e `npm run test:ui-directlab-shortlink`;
  - `supabase/tests/directlab_short_links.sql`;
  - `scripts/e2e/directlab-shortlink-e2e.mjs`.

## Landing pública de revendedores (`/revendedores`) e CMS (Admin › Landing Page)

A landing é **administrada pelo ADMIN** em **Admin › Landing Page**, sem editar arquivos nem fazer
deploy. O ADMIN edita conteúdo, imagens, preços, links, itens, ordem e visibilidade das seções. O
layout, o grid e os componentes continuam no código; não há editor HTML/CSS/JS.

- **Fluxo:** editar → **Salvar rascunho** → **Pré-visualizar** → **Publicar alterações** (com
  confirmação). Só a publicação muda `/revendedores`.
- **Tela:**
  - **barra de status:** Publicada / Alterações não publicadas / conteúdo padrão, com a data da
    última publicação;
  - **card "Landing publicada":** Abrir página / Copiar link;
  - **abas:**
    - **Conteúdo:** seções em cards, com "Exibir esta seção" e ↑↓; o Hero fica sempre no topo e o
      CTA final no fim;
    - **Comercial:** Atacado, Mensalidade e Contato, com o canal em uso visível;
    - **Mídia:** envio e exclusão de imagens;
    - **SEO e site:** SEO, menu, botão do cabeçalho, rodapé e descarte do rascunho.
- **Nossos Produtos** (carrossel de modelos de placas, entre Produto e Plataforma):
  - **Onde editar:** Conteúdo › Nossos Produtos. Rótulo, título e descrição são opcionais.
  - **Produtos:** até 30, recusados também no servidor acima disso. Cada um tem imagem da biblioteca
    `landing-assets`, título e descrição opcionais, texto alternativo, ativo e ordem (↑↓).
  - **Visibilidade:** só aparecem produtos ativos com imagem; sem nenhum, a seção some, inclusive
    do menu.
  - **Carrossel** (`src/components/landing/ProductsCarousel.tsx`): rolagem nativa com encaixe
    (swipe e touchpad), arrasto com mouse, setas e indicadores abaixo das imagens, teclado
    ← → Home End e movimento automático suave com botão de pausa. O movimento não roda com
    `prefers-reduced-motion`, com 1 produto ou fora da tela.
  - **Imagens:** carregadas aos poucos, com proporção fixa de 4:5 e sem distorção (`contain`).
  - **Fundo:** a seção fica fora da alternância branco/cinza, então ligá-la não muda as cores das
    outras seções.
  - **Banco:** sem migration. Documentos salvos antes ganham a seção vazia logo após Produto.
- **Banco** (migration `20261008120000_landing_cms.sql`):
  - `landing_documents`: um documento JSON em duas linhas, `draft` e `published`.
  - `landing_media`: biblioteca de imagens.
  - Publicar (`admin_landing_publish`) copia o rascunho para o publicado numa única transação:
    qualquer erro mantém a versão anterior.
  - Salvar e publicar conferem a versão (outra aba não sobrescreve).
  - O público lê só o publicado (`public_landing_content`); todo o resto é só ADMIN (`is_admin()`).
- **Esquema do conteúdo:** `src/lib/landing/schema.ts` (zod), com limites de tamanho e de itens por
  lista, só links `https://`, dinheiro em centavos inteiros e ícones de uma lista fixa. Validado no
  navegador, na API e de novo antes de publicar.
- **Conteúdo padrão:** `src/lib/landing/defaults.ts` é a landing original (textos e
  `src/config/landing-config.ts`). É usado enquanto nada for publicado ou se a migration não estiver
  aplicada, então a página nunca fica vazia.
- **Disponibilidade:** a página é estática regenerada (ISR, `revalidate = 300`); publicar chama
  `revalidatePath("/revendedores")`. Se o banco falhar em produção, o erro é registrado
  (`landing_published_load_failed`) e o Next continua servindo a última versão gerada.
- **Pré-visualização:** `/preview/revendedores`, só ADMIN, dinâmica e `noindex`.
- **Imagens:** bucket público `landing-assets`.
  - Só o ADMIN envia, apaga e lista.
  - Arquivos `media/<uuid>.png|jpg|webp` de até 4 MB, com o tipo validado pelos bytes (sem SVG).
  - Nada é sobrescrito.
  - Imagem em uso no rascunho ou no publicado não pode ser excluída.
  - As capturas que vêm com o projeto continuam disponíveis e podem ser trocadas em cada seção.
- **Contato:** WhatsApp (gera `https://wa.me/<número>?text=<mensagem>`), formulário e e-mail, com
  canal preferido ou automático (WhatsApp → formulário → e-mail). Sem nenhum canal, os botões levam
  a `#contato`.
- **Link público:** domínio do SEO (`siteUrl`) → domínio de produção da Vercel → domínio da
  requisição.
- **Testes:**
  - `npm run test:landing-cms` e `npm run test:ui-landing-editor`;
  - `supabase/tests/landing_cms.sql`;
  - `scripts/e2e/landing-cms-e2e.mjs` (inclui conteúdo extremo em 11 resoluções);
  - `scripts/e2e/landing-e2e.mjs` (landing padrão).

## DirectLab

**Hub.** `/admin/directlab` e `/reseller/directlab` mostram só o catálogo de ferramentas: cards grandes
e inteiros clicáveis, com o uso de cada uma. Cada ferramenta tem a própria página:

| Ferramenta | ADMIN | Revendedor |
|---|---|---|
| Avaliação Google | `/admin/directlab/google-review` | `/reseller/directlab/google-review` |
| DirectLink | `/admin/directlab/directlink` | `/reseller/directlab/directlink` |

Para criar uma ferramenta nova: um item em `DirectLabTools.tsx` e a página dela.

### Avaliação Google: fluxo e cobrança (migration `20261007120000_directlab_charge_on_success.sql`)

A ferramenta tem dois modos: **Colar link do Google** e **Pesquisar estabelecimento** (nome e/ou
endereço; a pesquisa só acontece ao clicar em Pesquisar, nunca enquanto se digita). O fluxo é:
resultados → **Selecionar** (não chama o servidor) → **Gerar link de avaliação**.
"Alterar estabelecimento" volta à lista.

**Regra da cota do revendedor: 1 utilização = 1 link de avaliação gerado com sucesso.**
- **Não descontam:** pesquisar, pesquisar de novo, resolver link, listar candidatos, selecionar,
  link inválido, nada encontrado, ambiguidade e qualquer erro (do Google, rede, timeout, link oficial
  ausente).
- **Pesquisa no limite:** funciona mesmo com o limite atingido; só a geração é bloqueada.
- **Etapas da geração:**
  1. consulta a cota **sem consumir** (`directlab_generation_check`);
  2. obtém o link oficial (`googleMapsLinks.writeAReviewUri`) e o valida;
  3. **só então** cobra, de forma atômica (`directlab_charge_generation`).

  Se a cobrança for recusada (ex.: outra aba esgotou a cota), o link não é entregue.
- **Sem cobrança dupla:** gerar de novo o **mesmo local no mesmo dia** (refresh/retry) não cobra.
  A tabela `directlab_generations` guarda só o md5 do Place ID por usuário e dia; registros com mais
  de 7 dias são apagados.
- **Concorrência:** duas gerações do mesmo local contam uma vez; locais diferentes disputam o
  incremento condicional atômico (o limite nunca é ultrapassado).
- **ADMIN:** continua ilimitado ("Sem limite diário"). A proteção curta (10/min) não mudou.

**Resolução de links** (`src/lib/directlab/resolver.ts` e `urls.ts`):
- **Seguir até a URL final:** `share.google`, `maps.app.goo.gl`, `goo.gl/maps` e `g.page` são
  seguidos até a URL final do Maps ou da Busca. URLs **intermediárias** do Google (ex.:
  `www.google.com/share.google?q=<código>`) são seguidas, e o código opaco **nunca** vira texto de
  busca. Era essa a principal causa das falhas com share.google.
- **Embrulhos:** `/url?q=…` e `consent.google.com/?continue=…` são desembrulhados sem acesso à rede
  (`consent.google.com` nunca é baixada).
- **Meta refresh:** numa resposta 200 de HTML, lê no máximo 32 KB só para achar
  `<meta http-equiv="refresh">`, tratado como mais um salto. Nenhum dado do local é lido do HTML.
- **Proteções:** só HTTPS, allowlist revalidada a cada salto antes da rede, DNS sem IP
  privado/loopback, IP literal recusado, laço detectado, no máximo 5 saltos e timeout por requisição
  e total.
- **Pistas lidas da URL final:**
  - **Place ID** (`query_place_id`, `q=place_id:`, `!1sChIJ…`);
  - **CID** (`?cid=`, `ftid=`, `!1s0x…:0x…`);
  - **kgmid** (`/g/…`);
  - nome (`/maps/place/<nome>`), texto (`q=`, `/maps/search/<texto>`, `/search?q=`) e coordenadas.
- **Identificação**, nesta ordem:
  1. Place ID → Place Details;
  2. **CID confirmado**: busca pelo nome perto do ponto, e o resultado cujo CID oficial
     (`googleMapsUri`) é o mesmo do link;
  3. um único resultado com o mesmo nome perto do ponto;
  4. lista para escolher.
- **Diagnóstico:** link que não se resolve gera o log `directlab_link_unrecognized` só com a
  **forma** da URL (host, caminho genérico, nomes de parâmetros), nunca valores.

**Chamadas à Places API** (fluxos típicos):

| Fluxo | Chamadas |
|---|---|
| Link com CID ou nome + ponto (o caso comum de share.google/maps.app.goo.gl) | 1 (busca, que já traz o link oficial) |
| Link com Place ID | 1 (Place Details) |
| Pesquisar → selecionar → gerar | 1 por pesquisa + 0 na geração |
| Link ambíguo → selecionar → gerar | 1 + 0 na geração |

Na geração depois de uma pesquisa, o servidor reaproveita o link oficial que a busca já trouxe por
um **comprovante assinado (HMAC)**, ligado ao usuário e válido por 15 minutos, com chave derivada da
service role. Comprovante inválido, vencido, alterado ou de outro usuário é ignorado, e o servidor
consulta o Google de novo; o link nunca vem do navegador.

A chave da Google é obtida sempre por `getGooglePlacesApiKey()` (ADMIN > ambiente).

### Chave da Google Places API (Configurações > Integrações)

O ADMIN troca a chave em **Configurações > Integrações > Google Places**, sem editar código nem
reiniciar. A tela permite testar a conexão, alterar a chave, configurar uma chave personalizada e
remover a configuração personalizada.

- **Prioridade:** 1) chave do ADMIN; 2) `GOOGLE_PLACES_API_KEY` do ambiente, que fica como
  fallback de emergência.
  - A resolução está numa função única: `getGooglePlacesApiKey()`
    (`src/lib/integrations/google-places/key.ts`).
  - A leitura de `GOOGLE_PLACES_API_KEY` existe num único lugar (`readGooglePlacesEnvKey()` em
    `src/lib/env.server.ts`).
  - Remover a chave do ADMIN nunca altera o ambiente.
- **Troca imediata:** sem cache. Cada operação lê a chave de novo, então trocar ou remover vale na
  próxima consulta, sem restart nem redeploy, em qualquer instância.
- **Armazenamento** (migration `20261006120000_google_places_integration.sql`):
  - A chave fica no **Supabase Vault** (`vault.secrets`), cifrada em repouso com chave mestra fora
    do banco.
  - Só `google_places_api_key()` a decifra, e essa função é executável **apenas pela service role**
    (servidor). Nem o ADMIN logado consegue ler a chave de volta.
  - A tabela `integration_settings` guarda só metadados: últimos 4 caracteres, datas e o código do
    último teste.
  - As RPCs do ADMIN (`admin_google_places_status|set|remove|record_test`) conferem `is_admin()` no
    banco.
- **Testar conexão:** testa a chave efetiva com uma chamada **real e mínima** ao Google (Text
  Search da Places API, só `places.id`, 1 resultado).
  - Não existe endpoint gratuito para validar uma chave; a chamada pode contar na cota ou no
    faturamento da sua conta Google Cloud.
  - Não consome a cota diária do DirectLab.
- **Testar e salvar:** confere o formato (`AIza` + 35 caracteres), testa no Google e só grava se o
  Google autorizar. Qualquer falha mantém a chave atual.
  - As respostas diferenciam `API key not valid`, `PERMISSION_DENIED` (com motivo seguro, ex.:
    `BILLING_DISABLED`), cota esgotada e falha de rede ou Google indisponível.
- **Navegador:** recebe só metadados. A chave nunca vai para props, HTML, payload do React, JS,
  cookies, storage, URL ou respostas.
- **Logs:** registram só códigos (`google_places_test_failed`, `google_places_key_lookup_failed`),
  nunca a chave nem o corpo das requisições.
- **Sem chave:** o ADMIN vê "Google Places ainda não foi configurado. Entre em Configurações >
  Integrações." O revendedor vê "A integração com o Google está temporariamente indisponível.
  Entre em contato com o administrador."
- **Pré-requisitos no Supabase:**
  - A extensão **Vault** (`supabase_vault`), habilitada por padrão. A migration tenta habilitá-la e,
    se não conseguir, para com uma mensagem clara.
  - A variável **`SUPABASE_SERVICE_ROLE_KEY`** no servidor. Sem ela, a chave salva não pode ser
    lida e a aplicação usa o ambiente; a tela avisa.
- **Testes locais:** o Vault é simulado em `supabase/tests/supabase_stubs.sql`, com a mesma API.

### Limites por revendedor (migration `20261005120000_directlab_reseller_limits.sql`)

O ADMIN define os limites em **Revendedores → (revendedor) → Limites do DirectLab**. Eles valem na hora.

- **Avaliação Google:** utilizações **por dia** (dia de Brasília). Padrão **10**.
- **DirectLink:** quantidade máxima de **páginas** que o revendedor pode ter (total, não diário).
  Padrão **3**.
- **ADMIN:** sem limite ("Sem limite diário").
- **Armazenamento:** a tabela `reseller_directlab_limits` guarda **só o valor atual**, sem histórico
  ou auditoria. Revendedor sem linha usa os padrões (`directlab_default_limits`). Ninguém acessa a
  tabela diretamente:
  - `admin_directlab_limits` e `admin_set_directlab_limits` são só para o ADMIN (0 a 1000);
  - `directlab_quota_status` e `directlink_page_status` mostram ao próprio revendedor o uso e o
    limite.
- **Aplicação no banco:**
  - `directlab_consume` (substituída nesta migration) usa o limite do revendedor.
  - Um gatilho em `direct_links` recusa página nova quando o revendedor já tem tantas quanto o
    limite (409, mensagem da conta). Criações simultâneas são serializadas.
  - O revendedor e o limite vêm da sessão, nunca do navegador.
- **Reduzir** nunca apaga nada: com 8 usos hoje e o limite reduzido para 5, só as próximas
  utilizações são recusadas até a virada do dia. Com 5 páginas e o limite reduzido para 3, as 5
  continuam ativas e públicas; só a criação fica bloqueada. **Aumentar** libera na hora.
- **Páginas inativas contam no total:** não há exclusão física de DirectLink.

### Erro "Erro ao acessar o banco de dados." no DirectLink

Essa mensagem aparecia quando a migration `20261004120000_directlink.sql` não estava aplicada: a
tabela `direct_links` não existe e o PostgREST responde `PGRST205`. Hoje a página mostra "Não foi
possível carregar os DirectLinks. Tente novamente." Para o ADMIN, ela também indica qual migration
aplicar. O código técnico fica só no log do servidor.

Para conferir no SQL Editor:

```sql
select to_regclass('public.direct_links');
```

O resultado `null` significa que a migration não foi aplicada.

Central de ferramentas para links e placas, em **ADMIN → DirectLab** (`/admin/directlab`) e
**Revendedor → DirectLab** (`/reseller/directlab`). As duas páginas usam o mesmo componente
(`src/components/directlab/`). A primeira ferramenta é **Avaliação Google**: link do estabelecimento →
link oficial para escrever uma avaliação.

### Fluxo (`POST /api/directlab/google-review`)

1. **Validação.** O link precisa ser HTTPS e de um host da allowlist (`src/lib/directlab/urls.ts`):
   `share.google`, `maps.app.goo.gl`, `goo.gl/maps`, `g.page`, `google.com`/`www.google.com`,
   `maps.google.com` e as versões `.com.br`. Fora da lista: recusado.
2. **Resolução.** Links curtos (`share.google`, `maps.app.goo.gl` e similares) são seguidos salto a
   salto; links do Google Maps já trazem as pistas e não geram nenhuma requisição. O HTML **nunca** é
   lido: só a URL de destino.
3. **Pistas da URL:** Place ID explícito (`query_place_id`, `place_id:`), nome do local
   (`/maps/place/<nome>`), texto de busca (`q=`) e coordenadas do ponto (`!3d…!4d…` ou `@lat,lng`).
4. **Google Places API (New), oficial.** Com Place ID, chama **Place Details**. Sem Place ID, chama
   **Text Search** com o nome, perto das coordenadas quando houver.
5. **Link final.** É sempre o `googleMapsLinks.writeAReviewUri` devolvido pela API. Se a API não o
   fornecer, a ferramenta avisa e **não monta um link à mão**.

**Sem escolha silenciosa.** O local só é escolhido automaticamente com correspondência única: um único
resultado de mesmo nome a até 150 m do ponto do link, ou busca sem coordenadas com um só resultado de
mesmo nome. Em qualquer outro caso, o usuário escolhe na lista. Se nada for identificado, aparece
**Pesquisar estabelecimento**, que também sempre pede a escolha. O local escolhido é consultado de
novo no Google: o link nunca vem do navegador.

### Proteção contra SSRF (`src/lib/directlab/resolver.ts`, `network.ts`)

Não existe `fetch(url_do_usuario)` direto. A cada salto, antes de qualquer acesso:

- a URL é revalidada: só HTTPS, host exato da allowlist, sem usuário/senha, sem porta, sem IP
  literal;
- o DNS é conferido: host que resolve para loopback, rede privada, link-local ou metadados
  (169.254.169.254), CGNAT, multicast ou IPv6 interno é recusado.

Além disso: redirect manual (no máximo 5 saltos), timeout de 4 s por requisição e 8 s no total, e o
corpo das respostas é descartado sem leitura. `consent.google.com` nunca é baixado: só o parâmetro
`continue` é lido, e revalidado. Limitação conhecida: entre a checagem de DNS e a conexão existe uma
janela teórica de *DNS rebinding*. Ela é mitigada porque só hostnames do próprio Google chegam a ser
resolvidos, e o DNS deles não é controlável por terceiros.

### Chave, custo e limites

- **`GOOGLE_PLACES_API_KEY`**: somente no servidor, sem `NEXT_PUBLIC_`. Vai só no cabeçalho
  `X-Goog-Api-Key` e nunca volta para o navegador. As respostas e os logs não a contêm.
- **Sem a chave:** o DirectLab mostra "não configurado" e o resto do sistema funciona normalmente.
- **Google Cloud:** habilite **Places API (New)** e restrinja a chave a essa API.
- **Custo:**
  - cada link gera de 1 a 2 chamadas pagas: Text Search e/ou Place Details;
  - escolher numa lista gera 1 Place Details;
  - os campos pedidos (FieldMask) são só `id`, `displayName`, `formattedAddress`, `location` e
    `googleMapsLinks`;
  - consulte os preços e a cota gratuita atuais na página de preços da Google Maps Platform;
    `googleMapsLinks` pode enquadrar a chamada numa faixa de preço acima da básica.
- **Limites (migration 021, `directlab_consume`).** O papel e os limites são decididos **no banco** a
  partir da sessão; a aplicação só diz qual contador consumir, então chamar a API diretamente não
  contorna a regra.
  - **Proteção curta:** 10 operações por minuto, para todos (inclusive ADMIN).
  - **Cota diária:** limite **por revendedor**, definido pelo ADMIN (padrão **10 por dia**; veja
    "Limites por revendedor"). **1 utilização = 1 link gerado com sucesso** (veja "Avaliação Google:
    fluxo e cobrança"). ADMIN não tem cota diária. O dia é o de Brasília: o contador recomeça à
    meia-noite de Brasília.
  - **O que conta como utilização:** uma por operação, consumida imediatamente antes da **primeira
    chamada à Places API**. Busca e detalhes na mesma operação contam uma vez só. Uma consulta
    iniciada conta mesmo se o Google responder com erro.
  - **O que não conta:** formulário vazio, URL inválida, domínio não permitido, pesquisa curta,
    Place ID inválido e links que não chegam à Places API (ex.: "não identificado").
  - **Cota esgotada:** a API responde 429 `daily_limit` e a Places API não é chamada.
  - **Interface:** a mensagem é "Você atingiu o limite diário definido para sua conta. Entre em contato
    com o administrador para aumentar o limite." O revendedor vê "N de M utilizações hoje", com o limite
    da conta dele.
  - **Armazenamento:** a tabela `directlab_usage` guarda **só números**, sem acesso direto de ninguém.
    Ela não é alcançada pela RPC genérica `consume_rate_limit` (migration 020, mantida). Uma disputa
    simultânea pela última utilização é resolvida no banco (incremento condicional atômico).
- **Nada é gravado** além desses contadores: não há histórico de links gerados.

### Usar em uma placa

Não há regra nova. O seletor (`GET /api/directlab/plates`, só leitura, com a sessão do usuário e a
RLS) lista:

- **Revendedor:** só as placas dele, sem as bloqueadas.
- **ADMIN:** qualquer placa, como na tela da placa.

Ao confirmar, a interface chama **a mesma rota da tela da placa**, com `destination_type =
google_review` e o cliente atual mantido:

- **Revendedor:** `POST /api/reseller/plates/[id]`, que usa a RPC `configure_reseller_plate`.
- **ADMIN:** `PATCH /api/admin/plates/[id]`.

A ativação automática (reservada → ativa), o bloqueio e o isolamento entre revendedores continuam
decididos por essas rotas e pelo banco.

### DirectLink (página "link na bio")

- **Página pública:** `/link/<código>` (ex.: `/link/D7A92KX`), sem login e mobile-first
  (largura máxima de 520 px), com banner, logo opcional, nome, descrição e botões.
  - A URL usa a mesma origem de `NEXT_PUBLIC_GO_BASE_URL`.
  - O `proxy` libera essa rota sem sessão, inclusive no domínio go.
- **Código público:** 7 caracteres aleatórios de um alfabeto sem ambiguidades, gerados pelo banco
  (`directlink_new_code`).
  - É **imutável**, não sequencial e não expõe IDs.
  - Continua válido se o nome da página mudar.
- **Banco** (migration `20261004120000_directlink.sql`):
  - Tabelas `direct_links` e `direct_link_items`. Os itens têm tipo, título, valor, recebedor (só
    PIX), ordem e ativo.
  - `directlink_save`: cria ou edita a página com seus itens numa operação só; confere a posse e
    que as imagens são da pasta do próprio usuário.
  - `directlink_set_active`: ativa ou desativa. Não há exclusão física.
  - `public_direct_link(code)`: a única leitura pública. Devolve só campos públicos e itens ativos,
    de páginas ativas.
- **RLS:** o revendedor vê e altera só os próprios DirectLinks; o ADMIN, todos. Um ID de outro
  dono é recusado pelo banco. O público não lê as tabelas; lê apenas pela RPC.
- **Storage:** bucket `directlink-assets`, de leitura pública.
  - Upload autenticado só na pasta do próprio usuário (`<uid>/banner|logo/<uuid>.<ext>`).
  - Aceita PNG, JPG e WEBP (sem SVG), validados pelo conteúdo real.
  - Não há atualização nem exclusão de arquivos.
- **Botões:** Instagram, WhatsApp, PIX, YouTube, Facebook, Site, Cardápio, Maps, Telefone, E-mail e
  Link genérico, reordenáveis com ↑/↓ e ativáveis/inativáveis.
  - URLs só `https://` (ou `http://`); `javascript:`, `data:` e `file:` são recusados.
  - WhatsApp, telefone e e-mail viram `wa.me`, `tel:` e `mailto:`.
  - Não há HTML, JS ou CSS personalizado.
- **PIX:** não há integração bancária. O botão abre o painel "Pagamento via PIX" com a chave e
  "Copiar chave" (Clipboard API, com o aviso "Chave PIX copiada", sem `alert`).
- **Usar em uma placa:** reaproveita o fluxo da Avaliação Google, gravando o destino como site pelas
  **rotas existentes** da placa. A ativação e as permissões são as de sempre.
- **Independente do Google:** não chama a Places API nem consome a cota diária da Avaliação Google.
- **Sem analytics nesta versão.** A página pública lê tudo de um único ponto (`public_direct_link`),
  onde a contagem de acessos poderá entrar no futuro.

## Redefinição de senha do revendedor

Em **Revendedores > (revendedor) > Acesso e segurança**, o ADMIN define **Nova senha** e
**Confirmar nova senha**, ou usa **Gerar senha temporária** (16 caracteres, gerados com Web Crypto no
navegador do ADMIN). A confirmação acontece num modal.

1. A rota `POST /api/admin/resellers/[id]/password` exige sessão ADMIN (`requireAdminApi`).
2. A senha é validada (mínimo de 10 caracteres, letras e números, confirmação igual) antes de qualquer
   chamada.
3. `admin_reseller_auth_user` revalida `is_admin()` **no banco** e devolve o usuário de Auth, só de
   revendedores.
4. A troca é feita pela **API administrativa do Supabase Auth** (`auth.admin.updateUserById`) com a
   service role, que existe só no servidor.
5. `admin_record_password_reset` grava em `admin_audit_events` o evento "Senha redefinida pelo
   administrador": quem, sobre quem e quando. **Nunca o valor.** A tabela é append-only e nenhuma
   tabela da aplicação tem coluna capaz de guardar senha.

A senha atual nunca pode ser visualizada. A temporária fica na tela só até o ADMIN clicar em
**Concluir**. Os logs de erro registram apenas o código de erro do Auth. `profiles.must_change_password`
fica marcado quando a senha é temporária, como preparação para "trocar senha no primeiro acesso": ainda
**não há** fluxo que obrigue a troca.

## Confirmações

As ações administrativas usam o modal do sistema (`src/components/ui/Modal.tsx`: `Modal` e
`ConfirmDialog`), no lugar de `window.confirm`, `window.prompt` e `alert`. Os casos são: quarentena
(com o campo Motivo dentro do modal), restaurar, arquivar e desarquivar lote, cancelamentos, troca e
remoção de revendedor, bloqueio de placa, desativação de revendedor, exclusão de cliente, redefinição
de senha e o fallback do botão Copiar. Cancelar ou pressionar Esc nunca executa a ação. As regras
continuam no servidor e no banco.

## Testes automatizados

```bash
npm run typecheck
npm run build
npm run test:renderer   # arte sintética: determinismo + decodificação do QR gerado (jsQR)
npm run test:exports    # Storage em memória: ZIP único, divisão em partes, manifests, QR, CSV
npm run test:sales-ui   # renderização do formulário de venda e das ações de cancelamento
npm run test:ui         # happy-dom: modais (cancelar/Esc não executam), nova venda do revendedor, gráficos
npm run test:password-reset  # redefinição de senha com o Supabase Auth simulado; nada é logado
npm run test:customers-branding  # nome de exibição, busca, fallback do branding, validação de upload com imagens reais
npm run test:ui-customers-login  # happy-dom: quarentena de clientes, abas, login padrão/personalizado, editor de branding
npm run test:directlab     # DirectLab: allowlist, SSRF (redirects, DNS privado, metadados), Places API simulada, escolha, chave fora das respostas
npm run test:ui-directlab  # happy-dom: estados da Avaliação Google, copiar link, candidatos, Usar em uma placa (revendedor e ADMIN)
npm run test:design-system # menus preservados, tons das badges, logo como asset único, NFC fora das métricas, fonte do login
npm run test:directlab-quota     # o que conta como utilização (inválidas não contam; 1 por operação; cota esgotada não chama o Google)
npm run test:ui-directlab-quota  # contador "N de 10 utilizações hoje", mensagem de limite, ADMIN sem contador
npm run test:sale-pricing        # cálculo em centavos, desconto, total do navegador ignorado, rota usa a RPC nova
npm run test:directlink          # validação de itens/URLs, links wa.me/tel/mailto, PIX, rota pública, sem cota do Google
npm run test:directlab-limits    # erro do DirectLink (tabela ausente), status de páginas, rota do ADMIN, hub sem formulário
npm run test:ui-directlab-limits # hub (limites e 'Sem limite diário'), DirectLink no limite, erro amigável, formulário do ADMIN
npm run test:google-places-key   # ADMIN > ambiente, troca sem restart, teste real mínimo (simulado), salvar só se válido, remover, logs/respostas sem chave
npm run test:ui-google-places    # tela de Integrações: máscara, password, testar e salvar, falha mantém a chave, remover com confirmação
npm run test:directlab-generation # cobrança só no sucesso (16 casos), links do Google (share.google, CID, redirects, bloqueios) e pesquisa
npm run test:ui-directlab-search  # modos link/pesquisa, selecionar sem chamar o servidor, alterar, gerar, contador e limite
npm run test:landing-cms          # CMS: esquema, padrão = landing original, contato/WhatsApp, SEO, fallback, imagens pelos bytes, rotas só ADMIN
npm run test:ui-landing-editor    # tela do CMS: editar, salvar, publicar (com confirmação), copiar link, preços em centavos, FAQ, seções, mídia
npm run test:landing-products     # Nossos Produtos: compatibilidade com documentos antigos, limite de 30 no servidor, visibilidade, menu
npm run test:ui-landing-products  # editor (adicionar, limite, ordem, ativo) e carrossel (1 produto, carregamento aos poucos, movimento reduzido)
```

Testes do banco. **Rode somente em banco de teste**, pois eles inserem dados:

- `behavior.sql` (14 cenários): versionamento, imutabilidade, idempotência, colisão de código,
  limites, RLS do revendedor, redirect e origem do acesso, fila com lease.
- `sales.sql` (19 cenários): venda automática e manual, idempotência, estoque insuficiente,
  placa já reservada/atribuída/bloqueada, barreiras do banco, lista de disponíveis, detalhe da venda,
  cancelamento devolvendo reservadas, bloqueio com placa ativa/bloqueada, ação explícita, vendas
  antigas e isolamento entre revendedores.
- `sales_concurrency.sql` (7 cenários, concorrência **real** com duas ou mais conexões via
  `dblink`): manual × manual na mesma placa, automática × automática, disputa das últimas placas,
  manual × automática, cancelamento × ativação nos dois sentidos e 8 vendas simultâneas.
- `operations.sql` (28 cenários): configuração de placas pelo revendedor (e tudo o que ele NÃO pode
  alterar), isolamento de clientes, atribuição e troca de revendedor com histórico, ativação
  automática ASSIGNED → ACTIVE, regra de redirect por status (ACTIVE redireciona; ASSIGNED,
  INACTIVE e BLOCKED não), revendedor sem poder de desbloquear, redirect sem efeitos colaterais na
  placa, vendas e métricas.

```bash
# PostgreSQL puro
createdb placas_test
psql -d placas_test -f supabase/tests/supabase_stubs.sql
for f in supabase/migrations/*.sql; do psql -d placas_test -v ON_ERROR_STOP=1 -f "$f"; done
psql -d placas_test -f supabase/tests/behavior.sql     # procure por "OK 1" … "OK 14"
psql -d placas_test -f supabase/tests/operations.sql   # procure por "OK A1" … "OK O5"
psql -d placas_test -f supabase/tests/sales.sql        # procure por "OK S1" … "OK S19"
psql -d placas_test -v dblink_conn='dbname=placas_test' -f supabase/tests/sales_concurrency.sql  # "OK C1" … "OK C7"
psql -d placas_test -v dblink_conn='dbname=placas_test' -f supabase/tests/batch_lifecycle.sql    # "OK L1" … "OK L17b"
psql -d placas_test -f supabase/tests/reseller_sales.sql                                         # "OK R1" … "OK R17"
psql -d placas_test -v dblink_conn='dbname=placas_test' -f supabase/tests/reseller_sale_customer_link.sql  # "OK B1" … "OK B17"
psql -d placas_test -f supabase/tests/qr_analytics.sql                                           # "OK Q1" … "OK Q7"
psql -d placas_test -f supabase/tests/admin_security.sql                                         # "OK P1" … "OK P6"
psql -d placas_test -f supabase/tests/customer_quarantine.sql                                    # "OK K1" … "OK K11"
psql -d placas_test -f supabase/tests/login_branding.sql                                         # "OK G1" … "OK G8"
psql -d placas_test -f supabase/tests/directlab.sql                                              # "OK D1" … "OK D7"
psql -d placas_test -v dblink_conn='dbname=placas_test host=/tmp' -f supabase/tests/directlab_quota.sql  # "OK Q1" … "OK Q10"
psql -d placas_test -f supabase/tests/sale_pricing.sql                                          # "OK S1" … "OK S12"
psql -d placas_test -f supabase/tests/directlink.sql                                            # "OK DL1" … "OK DL13"
psql -d placas_test -v dblink_conn='dbname=placas_test host=/tmp' -f supabase/tests/directlab_limits.sql  # "OK LM1" … "OK LM17"
psql -d placas_test -f supabase/tests/google_places_integration.sql                             # "OK G1" … "OK G9" (Vault simulado nos stubs)
psql -d placas_test -v dblink_conn='dbname=placas_test host=/tmp' -f supabase/tests/directlab_charge.sql  # "OK CH1" … "OK CH11"
psql -d placas_test -f supabase/tests/landing_cms.sql                                            # "OK LC1" … "OK LC11"
```

**Teste ponta a ponta do login (opcional, navegador real).** O script `scripts/e2e/login-e2e.mjs`
abre `/login` num Chromium contra um Supabase simulado (`scripts/e2e/supabase-stub.mjs`). Ele mede
overflow horizontal de 320 a 1920 px, troca de banner e logo, fallback e o fluxo de login de ADMIN,
revendedor e conta inativa. As instruções estão no topo do script; ele precisa de `puppeteer-core` e
de um Chromium, que não são dependências do projeto. `scripts/e2e/directlab-e2e.mjs` faz o mesmo para
o DirectLab: rotas recusadas sem login, ADMIN e revendedor autenticados, layout sem overflow no celular
e cópia real para a área de transferência.

`reseller_sale_customer_link.sql` cobre a venda B2C com vínculo automático ao cliente. Os cenários
são: com e sem cliente, recusas, duplicidade, não ativação, configuração posterior, os dois tipos de
cancelamento, várias placas e rollback com falha injetada no meio da operação. O último bloco (B17)
usa `dblink` para disputar ativação × cancelamento com duas conexões reais.

`batch_lifecycle.sql` também usa `dblink`: os dois últimos blocos abrem duas conexões reais para
disputar o mesmo lote (venda × quarentena), nos dois sentidos.

`sales_concurrency.sql` precisa da extensão `dblink` e de uma string de conexão que o próprio
servidor consiga usar (no Supabase local, por exemplo,
`-v dblink_conn='host=127.0.0.1 port=54322 user=postgres password=postgres dbname=postgres'`).

Com Supabase local (`npx supabase start`), pule os stubs e rode só os arquivos de teste.

## Limitações atuais

- **Exportações dependem de um gatilho.** Sem cron frequente, jobs grandes avançam só enquanto a tela
  do lote estiver aberta (ou quando alguém a abrir de novo).
- **Arquivos órfãos não são limpos**: uploads em `staging/` abandonados, prévias em `previews/` e
  partes de exportações interrompidas. Uma rotina de limpeza fica para a próxima etapa.
- **Preview rápido vs. prévia fiel**: antialiasing de texto e gerenciamento de cor (perfil ICC) podem
  diferir levemente entre navegador e Skia. A prévia fiel é a referência.
- **Revendedores**: não há redefinição de senha nem troca de e-mail pelo painel. Use o painel do
  Supabase (Authentication).
- **Vendas**: registro com um item de placas por venda, até 2.000 placas. Não é possível editar
  itens nem trocar placas de uma venda depois de criada; para corrigir, cancele a venda e registre
  outra. Vendas anteriores a esta versão não têm placas vinculadas (não há como saber quais eram).
- **Métricas**:
  - "Placas mais acessadas" usa o total histórico.
  - O resumo operacional é sempre a situação atual.
  - O faturamento por revendedor na lista de revendedores é calculado em TypeScript sobre as vendas
    pagas. Para volumes muito grandes, vale mover para uma função no banco.
- **URLs de destino** precisam de domínio com extensão: endereços IP e `localhost` são recusados, e
  domínios com acento precisam estar em punycode.
- **Outros pontos pendentes**:
  - PDF de impressão (`art_pdf`) não implementado.
  - Tipos do banco escritos à mão em `src/lib/db/types.ts` (podem ser gerados com
    `npx supabase gen types typescript`).
  - Sem limite de taxa no redirect público.
- **Página `/forbidden`**: responde com status 200. As APIs e a RLS devolvem 403 de verdade.
- **Editor de template**: arrasta o QR e o código, mas o redimensionamento é pelos campos numéricos.
- **Sem teste visual automatizado em navegador**: as rotas foram verificadas com o servidor
  rodando.
