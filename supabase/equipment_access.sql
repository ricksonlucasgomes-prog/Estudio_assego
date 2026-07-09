-- =====================================================================
-- Controle de acesso a equipamentos + aprovador único (Lucas Rickson)
-- Execute no SQL Editor do Supabase DEPOIS de:
--   1) schema.sql
--   2) studio_booking.sql
--   3) legal_signatures.sql
-- Reexecutável (create if not exists / drop policy if exists / create or replace).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1) Aprovador único: só Lucas Rickson pode aprovar/rejeitar QUALQUER
--    solicitação (agendamento do estúdio OU retirada de equipamento).
--    Badu, Sérgio Vinicius e Sgt. Tiago Raiz continuam enxergando as
--    listas (policies de SELECT usam current_user_is_booking_approver,
--    sem alteração), mas não têm UPDATE liberado.
--    Lucas é 'developer' (não 'admin') — aceita os dois papéis aqui.
--    Requer supabase/add_developer_role.sql (CHECK da coluna) para o
--    valor 'developer' existir de fato num profile.
-- ---------------------------------------------------------------------
create or replace function public.current_user_is_lead_approver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'developer')
      and lower(p.full_name) like 'lucas%'
  );
$$;

-- ---------------------------------------------------------------------
-- 2) Restringe o UPDATE (aprovar/rejeitar) de studio_booking_requests
--    ao aprovador único. O SELECT continua liberado para os 3 admins
--    (current_user_is_booking_approver, definido em studio_booking.sql).
-- ---------------------------------------------------------------------
drop policy if exists "booking_req_update_admin" on public.studio_booking_requests;

create policy "booking_req_update_admin" on public.studio_booking_requests
for update to authenticated
using (public.current_user_is_lead_approver())
with check (public.current_user_is_lead_approver());

-- ---------------------------------------------------------------------
-- 3) Retirada de equipamento por quem NÃO é admin: solicitação com
--    justificativa, sujeita à mesma aprovação exclusiva do Lucas.
--    Quem é admin/borrower não passa por aqui — retira direto na aba
--    "Pegar Equipamento do Estúdio" (studio_checkouts).
-- ---------------------------------------------------------------------
create table if not exists public.studio_equipment_requests (
  id uuid primary key default gen_random_uuid(),

  requester_id    uuid references auth.users(id),
  requester_name  text not null,
  requester_email text,

  equipment_id    text not null,
  equipment_name  text not null,
  justification   text not null,

  status          text not null default 'requested'
                    check (status in ('requested', 'approved', 'rejected')),

  created_at      timestamptz not null default now()
);

create index if not exists studio_equipment_requests_requester_idx
  on public.studio_equipment_requests (requester_id);

alter table public.studio_equipment_requests enable row level security;

drop policy if exists "equip_req_insert_self"         on public.studio_equipment_requests;
drop policy if exists "equip_req_select_own_or_admin" on public.studio_equipment_requests;
drop policy if exists "equip_req_update_lead_approver" on public.studio_equipment_requests;

-- Qualquer usuário autenticado (mesmo viewer) pode pedir equipamento
-- justificando o motivo — só em nome dele mesmo.
create policy "equip_req_insert_self" on public.studio_equipment_requests
for insert to authenticated
with check (requester_id = auth.uid());

-- Solicitante vê a própria; os 3 admins (mesma regra de aprovador de
-- agendamento) veem todas.
create policy "equip_req_select_own_or_admin" on public.studio_equipment_requests
for select to authenticated
using (requester_id = auth.uid() or public.current_user_is_booking_approver());

-- Só o aprovador único (Lucas) aprova/rejeita.
create policy "equip_req_update_lead_approver" on public.studio_equipment_requests
for update to authenticated
using (public.current_user_is_lead_approver())
with check (public.current_user_is_lead_approver());

do $$
begin
  alter publication supabase_realtime add table public.studio_equipment_requests;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- 4) Email de quem retirou o equipamento (para o aviso de atraso de 7
--    dias). O checkout já é feito por admin/borrower autenticado; a UI
--    manda o email da sessão logada.
-- ---------------------------------------------------------------------
alter table public.studio_checkouts add column if not exists user_email text;
alter table public.studio_checkouts add column if not exists justification text;
