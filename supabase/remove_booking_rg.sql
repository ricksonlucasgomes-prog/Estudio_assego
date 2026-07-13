-- Remove definitivamente o RG do fluxo de agendamento.
-- Reexecutavel e seguro para instalacoes novas ou existentes.
begin;

alter table public.studio_booking_requests
  drop column if exists requester_rg;

alter table public.studio_booking_participants
  drop column if exists rg;

commit;
