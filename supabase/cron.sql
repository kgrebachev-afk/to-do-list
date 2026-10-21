-- =====================================================================
-- To do list : envoi des rappels chaque minute.
-- À exécuter APRÈS avoir créé la fonction « send-reminders ».
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

insert into private.secrets (name, value)
values ('cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;
insert into private.secrets (name, value)
values ('function_url', '{{PROJECT_URL}}/functions/v1/send-reminders')
on conflict (name) do update set value = excluded.value;

select cron.unschedule('todo-send-reminders') where exists (select 1 from cron.job where jobname = 'todo-send-reminders');
select cron.schedule('todo-send-reminders', '* * * * *', $job$
  select net.http_post(
    url     := (select value from private.secrets where name = 'function_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select value from private.secrets where name = 'cron')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
$job$);

-- Ménage quotidien : historique du cron (2 jours), rappels envoyés, listes abandonnées depuis plus d'un an,
-- QR codes expirés, traces anti-abus.
select cron.unschedule('todo-cron-cleanup') where exists (select 1 from cron.job where jobname = 'todo-cron-cleanup');
select cron.schedule('todo-cron-cleanup', '17 3 * * *', $job$
  delete from cron.job_run_details where end_time < now() - interval '2 days';
  delete from public.reminders where sent_at < now() - interval '30 days';
  delete from public.accounts where last_seen < now() - interval '400 days';
  delete from public.pairings where expires_at < now() - interval '1 hour';
  delete from public.items where deleted and modified_at < now() - interval '365 days';
  delete from private.creations where at < now() - interval '1 day';
  delete from public.retired_accounts where retired_at < now() - interval '400 days';
$job$);
