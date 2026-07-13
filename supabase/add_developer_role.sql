-- =====================================================================
-- Papel "developer" (acesso total, equivalente a admin) para Lucas Rickson
-- NÃO EXECUTADA AINDA — proposta para revisão do Lucas antes de rodar.
--
-- Diagnóstico do estado atual (sem alterar nada):
--   - public.profiles.role é `text` com CHECK (role in ('admin','borrower','viewer'))
--     (supabase/schema.sql). Inserir 'developer' hoje FALHA nesse CHECK.
--   - public.current_user_role() (schema.sql) só lê a coluna e é usada por
--     TODAS as policies "genéricas" (studio_checklist, studio_checkouts,
--     studio_observations, studio_conferences, studio_media, equipment,
--     equipment_loans, checklists, checklist_items, profiles_update_admin
--     — ~10 policies no total), sempre comparando
--     `current_user_role() = 'admin'` ou `in ('admin', 'borrower')`.
--   - current_user_is_booking_approver() (studio_booking.sql) e
--     current_user_is_lead_approver() (equipment_access.sql) NÃO passam
--     por current_user_role() — consultam profiles.role direto. Ambas já
--     foram atualizadas nos seus arquivos de origem para aceitar
--     role in ('admin', 'developer'), então não precisam de nada aqui.
--
-- Decisão de design: em vez de reescrever as ~10 policies genéricas uma a
-- uma, normalizamos dentro de current_user_role() — quem tem role
-- 'developer' no banco "aparenta" ser 'admin' para toda regra que só
-- conhece current_user_role(). O valor exibido na UI continua sendo o real
-- ('developer'), porque o front lê profiles.role direto (não passa por
-- essa função). Resultado: 1 função alterada cobre as ~10 policies de uma
-- vez, sem duplicar lógica de aprovador em vários lugares.
--
-- Execute no SQL Editor do Supabase, NESTA ORDEM, só depois de revisar:
-- =====================================================================

-- 1) Permitir 'developer' na coluna de role.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'developer', 'borrower', 'viewer'));

-- 2) current_user_role() passa a normalizar 'developer' -> 'admin' para
--    fins de permissão. Isso cobre, sem tocar em mais nada:
--      profiles_update_admin, equipment_*_staff, loans_*_staff,
--      checklists_*_staff, items_*_staff, wr_checklist, wr_checkouts,
--      wr_obs, wr_conf, wr_media (todas em schema.sql).
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select role from public.profiles where id = auth.uid()) = 'developer' then 'admin'
    else coalesce((select role from public.profiles where id = auth.uid()), 'viewer')
  end;
$$;

revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

-- 3) current_user_is_booking_approver() e current_user_is_lead_approver()
--    já aceitam 'developer' diretamente (ver studio_booking.sql e
--    equipment_access.sql) — nada a fazer aqui.

-- 4) Promover o Lucas depois que os passos acima rodarem:
-- update public.profiles set role = 'developer' where lower(full_name) like 'lucas%';
