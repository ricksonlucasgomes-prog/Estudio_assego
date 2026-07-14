-- =====================================================================
-- Correcao F-04: autorizacao de aprovador deixa de usar full_name.
-- Seguro rodar isolado (apenas redefine 2 funcoes; sem tabelas/policies).
-- Aplicar no SQL Editor do Supabase OU:
--   supabase db execute --file supabase/fix_f04_approver_authz.sql
-- =====================================================================

-- Aprovador unico (decide/aprova): ancorado no e-mail de auth.users,
-- que e unico e exige re-confirmacao para mudar -- nao falsificavel.
create or replace function public.current_user_is_lead_approver()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid()
      and p.role in ('admin', 'developer')
      and lower(u.email) = 'ricksonlucasgomes@gmail.com'
  );
$$;

revoke all on function public.current_user_is_lead_approver() from public, anon;
grant execute on function public.current_user_is_lead_approver() to authenticated;

-- Quem VE a lista de agendamentos: apenas por papel (role), nunca por nome.
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
