-- =====================================================================
-- Agenda diária do aviso de atraso de equipamento (7 dias corridos).
-- Execute no SQL Editor do Supabase DEPOIS de publicar a Edge Function
-- `check-overdue-equipment` (supabase functions deploy check-overdue-equipment).
--
-- Pré-requisito: habilitar as extensões "pg_cron" e "pg_net" em
-- Database > Extensions no painel do Supabase (não dá para habilitar
-- extensão de projeto por SQL de app comum; é um toggle do projeto).
--
-- Troque <PROJECT_REF> e <ANON_KEY> pelos valores reais do projeto antes
-- de rodar (mesmos valores de VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).
-- =====================================================================

select cron.schedule(
  'check-overdue-equipment-daily',
  '0 13 * * *', -- 13h UTC = 10h em Brasilia (sem horario de verao)
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/check-overdue-equipment',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Para conferir/remover depois:
-- select * from cron.job;
-- select cron.unschedule('check-overdue-equipment-daily');
