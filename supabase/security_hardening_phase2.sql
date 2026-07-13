-- =====================================================================
-- ASSEGO Studio - hardening de seguranca (fase 2, restritiva)
--
-- SOMENTE execute depois de:
--   1) security_hardening_phase1.sql aplicada;
--   2) Edge Functions V2 publicadas e validadas;
--   3) lead_approvers conter exatamente o UUID do Lucas;
--   4) frontend usar as RPCs de alteracao de status.
-- =====================================================================

begin;

do $$
begin
  if (select count(*) from public.lead_approvers) <> 1 then
    raise exception 'A fase 2 exige exatamente um lead_approver.';
  end if;

  if exists (
    select 1 from public.legal_signatures where booking_request_id is null
  ) then
    raise exception 'Existem assinaturas sem agendamento. Reconcilie antes da fase 2.';
  end if;
end;
$$;

-- Papel protegido: nomes deixam de participar da autorizacao.
create or replace function public.current_user_is_booking_approver()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'developer')
  );
$$;

revoke all on function public.current_user_is_booking_approver() from public, anon;
grant execute on function public.current_user_is_booking_approver() to authenticated;

-- Bloqueia inserts/deletes diretos que contornavam a Edge Function.
drop policy if exists "booking_req_insert_self" on public.studio_booking_requests;
drop policy if exists "booking_req_update_admin" on public.studio_booking_requests;
drop policy if exists "booking_req_delete_own_or_admin" on public.studio_booking_requests;
drop policy if exists "booking_part_insert_own" on public.studio_booking_participants;
drop policy if exists "booking_part_delete_own_or_admin" on public.studio_booking_participants;
drop policy if exists "legal_sig_insert_self" on public.legal_signatures;

revoke insert, update, delete on public.studio_booking_requests from anon, authenticated;
revoke insert, update, delete on public.studio_booking_participants from anon, authenticated;
revoke insert, update, delete on public.legal_signatures from anon, authenticated;

-- A assinatura deixa de desaparecer quando uma reserva e excluida.
alter table public.legal_signatures
  alter column booking_request_id set not null;

alter table public.legal_signatures
  drop constraint if exists legal_signatures_booking_request_id_fkey;

alter table public.legal_signatures
  add constraint legal_signatures_booking_request_id_fkey
  foreign key (booking_request_id)
  references public.studio_booking_requests(id)
  on delete restrict;

-- Pedidos de equipamento tambem passam exclusivamente pela Edge/RPC.
drop policy if exists "equip_req_insert_self" on public.studio_equipment_requests;
drop policy if exists "equip_req_update_lead_approver" on public.studio_equipment_requests;
revoke insert, update, delete on public.studio_equipment_requests from anon, authenticated;

-- Perfis: o trigger de cadastro continua criando viewer como owner da funcao.
-- Clientes leem o proprio perfil; somente a diretoria le todos.
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_select_self_or_staff" on public.profiles;

create policy "profiles_select_self_or_staff" on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.current_user_role() = 'admin'
);

revoke insert, update, delete on public.profiles from anon, authenticated;

-- Logs sao gerados somente pelo backend e lidos somente pela diretoria.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

drop policy if exists "audit_select_authenticated" on public.audit_logs;
drop policy if exists "audit_insert_authenticated" on public.audit_logs;
drop policy if exists "audit_select_staff" on public.audit_logs;

create policy "audit_select_staff" on public.audit_logs
for select to authenticated
using (public.current_user_role() = 'admin');

revoke insert, update, delete on public.audit_logs from anon, authenticated;

-- Histórico imutavel das retiradas encerradas.
create table if not exists public.studio_checkout_history (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  user_name text not null,
  user_id uuid references auth.users(id),
  user_email text,
  qty integer not null,
  photo text,
  justification text,
  taken_at timestamptz not null,
  returned_at timestamptz not null default now(),
  returned_by uuid references auth.users(id)
);

alter table public.studio_checkout_history enable row level security;
revoke insert, update, delete on public.studio_checkout_history from anon, authenticated;

drop policy if exists "checkout_history_select_staff" on public.studio_checkout_history;
create policy "checkout_history_select_staff" on public.studio_checkout_history
for select to authenticated
using (public.current_user_role() = 'admin');

create or replace function public.archive_studio_checkout()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.studio_checkout_history (
    item_id, user_name, user_id, user_email, qty, photo,
    justification, taken_at, returned_at, returned_by
  ) values (
    old.item_id, old.user_name, old.user_id, old.user_email, old.qty, old.photo,
    old.justification, old.taken_at, clock_timestamp(), auth.uid()
  );
  return old;
end;
$$;

revoke all on function public.archive_studio_checkout() from public, anon, authenticated;

drop trigger if exists archive_studio_checkout_before_delete on public.studio_checkouts;
create trigger archive_studio_checkout_before_delete
before delete on public.studio_checkouts
for each row execute function public.archive_studio_checkout();

-- Dados operacionais com PII deixam de ser visiveis para viewer.
drop policy if exists "sel_checkouts" on public.studio_checkouts;
drop policy if exists "wr_checkouts" on public.studio_checkouts;
drop policy if exists "sel_obs" on public.studio_observations;
drop policy if exists "wr_obs" on public.studio_observations;
drop policy if exists "sel_conf" on public.studio_conferences;
drop policy if exists "wr_conf" on public.studio_conferences;
drop policy if exists "sel_media" on public.studio_media;
drop policy if exists "wr_media" on public.studio_media;
drop policy if exists "checkouts_select_staff" on public.studio_checkouts;
drop policy if exists "checkouts_insert_staff" on public.studio_checkouts;
drop policy if exists "checkouts_update_staff" on public.studio_checkouts;
drop policy if exists "checkouts_delete_staff" on public.studio_checkouts;
drop policy if exists "observations_select_staff" on public.studio_observations;
drop policy if exists "observations_insert_staff" on public.studio_observations;
drop policy if exists "conferences_select_staff" on public.studio_conferences;
drop policy if exists "conferences_insert_staff" on public.studio_conferences;
drop policy if exists "media_select_staff" on public.studio_media;
drop policy if exists "media_insert_staff" on public.studio_media;
drop policy if exists "media_delete_admin" on public.studio_media;

create policy "checkouts_select_staff" on public.studio_checkouts
for select to authenticated
using (public.current_user_role() in ('admin', 'borrower'));
create policy "checkouts_insert_staff" on public.studio_checkouts
for insert to authenticated
with check (public.current_user_role() in ('admin', 'borrower'));
create policy "checkouts_update_staff" on public.studio_checkouts
for update to authenticated
using (public.current_user_role() in ('admin', 'borrower'))
with check (public.current_user_role() in ('admin', 'borrower'));
create policy "checkouts_delete_staff" on public.studio_checkouts
for delete to authenticated
using (public.current_user_role() in ('admin', 'borrower'));

create policy "observations_select_staff" on public.studio_observations
for select to authenticated
using (public.current_user_role() in ('admin', 'borrower'));
create policy "observations_insert_staff" on public.studio_observations
for insert to authenticated
with check (
  public.current_user_role() in ('admin', 'borrower')
  and author_id = auth.uid()
);

create policy "conferences_select_staff" on public.studio_conferences
for select to authenticated
using (public.current_user_role() in ('admin', 'borrower'));
create policy "conferences_insert_staff" on public.studio_conferences
for insert to authenticated
with check (
  public.current_user_role() in ('admin', 'borrower')
  and author_id = auth.uid()
);

create policy "media_select_staff" on public.studio_media
for select to authenticated
using (public.current_user_role() in ('admin', 'borrower'));
create policy "media_insert_staff" on public.studio_media
for insert to authenticated
with check (
  public.current_user_role() in ('admin', 'borrower')
  and added_by_id = auth.uid()
);
create policy "media_delete_admin" on public.studio_media
for delete to authenticated
using (public.current_user_role() = 'admin');

commit;
