-- =====================================================================
-- Agenda diária do aviso de atraso de equipamento (7 dias corridos).
-- Execute no SQL Editor do Supabase DEPOIS de publicar a Edge Function
-- `check-overdue-equipment` (supabase functions deploy check-overdue-equipment).
--
-- Pré-requisito: habilitar as extensões "pg_cron" e "pg_net" em
-- Database > Extensions no painel do Supabase (não dá para habilitar
-- extensão de projeto por SQL de app comum; é um toggle do projeto).
--
-- Requer no Vault o secret cron_secret, igual ao CRON_SECRET configurado
-- na Edge Function:
--
-- select vault.create_secret('valor-forte-aqui', 'cron_secret');
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'check-overdue-equipment-daily';

  perform cron.schedule(
    'check-overdue-equipment-daily',
    '0 13 * * *', -- 13h UTC = 10h em Brasília (sem horário de verão)
    $cron$
      select net.http_post(
        url := 'https://nqjaxsehplhbusrleuhd.supabase.co/functions/v1/check-overdue-equipment',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'cron_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $cron$
  );
end;
$$;

-- Para conferir/remover depois:
-- select * from cron.job;
-- select cron.unschedule('check-overdue-equipment-daily');
