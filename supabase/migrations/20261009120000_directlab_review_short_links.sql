-- =====================================================================
-- 028 · Link curto da Avaliação Google: /r/<código> (pensado para NFC)
--
-- A Avaliação Google continua encontrando o estabelecimento e obtendo o
-- link OFICIAL (writeAReviewUri) exatamente como antes. Agora, ao concluir
-- a geração, a DirectPlaca guarda esse destino e entrega um link curto
-- próprio (origem de NEXT_PUBLIC_GO_BASE_URL + /r/<7 caracteres>).
--
--   · NÃO é um encurtador genérico: o destino só pode ser um link de
--     avaliação do Google (validado aqui no banco) e só é gravado pela
--     finalização da geração — nunca a partir de um destino enviado pelo
--     navegador para a rota pública.
--   · Código aleatório (7 de 31 símbolos ≈ 27,5 bilhões), único e IMUTÁVEL.
--   · Mesmo dono + mesmo Place ID → mesmo código (o destino pode ser
--     atualizado se o Google devolver outra URL; o código continua).
--   · Dono com ON DELETE SET NULL: um link já gravado numa tag NFC não
--     quebra se a conta do revendedor deixar de existir.
--   · directlab_finalize_generation cobra a utilização E cria/reaproveita o
--     link numa ÚNICA transação: se o link falhar, a cobrança é desfeita.
--   · Acessar /r/<código> só consulta public_review_link (código → destino):
--     não chama o Google, não consome cota, não registra acesso.
--
-- Incremental e idempotente; não altera migrations anteriores.
-- =====================================================================

/** Destino permitido: SÓ links de avaliação do Google, em https, sem truques de caminho. */
create or replace function public.directlab_review_destination_ok(p_url text)
returns boolean
language sql
immutable
as $$
  select p_url is not null
    and length(p_url) between 20 and 2048
    and p_url !~ '[[:space:]<>"\\]'
    and p_url !~* '(\.\.|%2e|%5c)'
    and (
         p_url ~ '^https://(www\.|maps\.)?google\.com/maps/'
      or p_url ~ '^https://search\.google\.com/local/writereview(\?|$)'
      or p_url ~ '^https://g\.page/r/'
    );
$$;

create table if not exists public.directlab_review_links (
  id                uuid primary key default gen_random_uuid(),
  public_code       text not null,
  owner_id          uuid references auth.users (id) on delete set null,
  google_place_id   text not null,
  destination_url   text not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_verified_at  timestamptz not null default now(),
  constraint directlab_review_links_code_key unique (public_code),
  constraint directlab_review_links_code_check check (public_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$'),
  -- (o PostgreSQL limita repetições de regex a 255: o tamanho é conferido à parte)
  constraint directlab_review_links_place_check check (google_place_id ~ '^[A-Za-z0-9_-]+$' and length(google_place_id) <= 300),
  constraint directlab_review_links_destination_check check (public.directlab_review_destination_ok(destination_url))
);

comment on table public.directlab_review_links is
  'Links curtos /r/<código> da Avaliação Google (destino = link oficial de avaliação). Código imutável.';

-- Reaproveitamento: um código por dono + Place ID (dono nulo = conta removida: não conflita).
create unique index if not exists directlab_review_links_owner_place_key
  on public.directlab_review_links (owner_id, google_place_id);

-- Código imutável depois de criado.
create or replace function public.directlab_review_links_freeze_code()
returns trigger
language plpgsql
as $$
begin
  if new.public_code is distinct from old.public_code then
    raise exception 'O código do link curto não pode ser alterado.' using errcode = '55000';
  end if;
  return new;
end;
$$;
drop trigger if exists directlab_review_links_freeze_code on public.directlab_review_links;
create trigger directlab_review_links_freeze_code
  before update on public.directlab_review_links
  for each row execute function public.directlab_review_links_freeze_code();

alter table public.directlab_review_links enable row level security;
revoke all on public.directlab_review_links from anon, authenticated;

/** Código aleatório (mesmo alfabeto e fonte de aleatoriedade do DirectLink), sem repetir. */
create or replace function public.directlab_review_new_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..6 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i + 8) % 31) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.directlab_review_links l where l.public_code = v_code);
  end loop;
  return v_code;
end;
$$;
revoke all on function public.directlab_review_new_code() from public, anon, authenticated;

/**
 * Conclui a geração da Avaliação Google: cobra a utilização (mesma regra de
 * directlab_charge_generation: só no sucesso, sem cobrança dupla do mesmo
 * local no dia, ADMIN ilimitado) E cria/reaproveita o link curto — tudo na
 * MESMA transação. Qualquer falha ao criar o link desfaz a cobrança.
 */
create or replace function public.directlab_finalize_generation(p_place_id text, p_destination_url text)
returns table (
  allowed              boolean,
  charged              boolean,
  used_today           integer,
  daily_limit          integer,
  retry_after_seconds  integer,
  public_code          text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_charge record;
  v_code text;
  v_attempt integer := 0;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if p_place_id is null or p_place_id !~ '^[A-Za-z0-9_-]+$' or length(p_place_id) > 300 then
    raise exception 'Place ID inválido.' using errcode = '22023';
  end if;
  if not public.directlab_review_destination_ok(p_destination_url) then
    raise exception 'Destino não é um link de avaliação do Google.' using errcode = '22023';
  end if;

  select * into v_charge from public.directlab_charge_generation(p_place_id);
  if not v_charge.allowed then
    return query select false, false, v_charge.used_today, v_charge.daily_limit, v_charge.retry_after_seconds, null::text;
    return;
  end if;

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.directlab_review_links as l (public_code, owner_id, google_place_id, destination_url)
      values (public.directlab_review_new_code(), v_uid, p_place_id, p_destination_url)
      on conflict (owner_id, google_place_id) do update
        set destination_url  = excluded.destination_url,
            updated_at       = case when l.destination_url is distinct from excluded.destination_url then now() else l.updated_at end,
            last_verified_at = now()
      returning l.public_code into v_code;
      exit;
    exception when unique_violation then
      -- Colisão de código (corrida rara entre gerar e gravar): tenta outro.
      if v_attempt >= 8 then
        raise exception 'Não foi possível gerar um código único.' using errcode = '55000';
      end if;
    end;
  end loop;

  return query select true, v_charge.charged, v_charge.used_today, v_charge.daily_limit, v_charge.retry_after_seconds, v_code;
end;
$$;
revoke all on function public.directlab_finalize_generation(text, text) from public, anon;
grant execute on function public.directlab_finalize_generation(text, text) to authenticated;

/**
 * Leitura PÚBLICA mínima: recebe só o código e devolve só o destino (ativo e
 * válido). Não lista nada, não expõe dono, Place ID nem datas.
 */
create or replace function public.public_review_link(p_code text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select l.destination_url
  from public.directlab_review_links l
  where l.public_code = upper(p_code)
    and l.is_active
    and public.directlab_review_destination_ok(l.destination_url);
$$;
revoke all on function public.public_review_link(text) from public;
grant execute on function public.public_review_link(text) to anon, authenticated;
