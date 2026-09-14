begin;

-- Hráči se registrují anonymní relací Supabase. Kontaktní e-mail se ukládá,
-- ale neprohlašuje se za ověřený.
alter table public.participants
  alter column email_verified_at drop not null;

alter table public.participants
  add column if not exists digest_sent_at timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consent_events' and column_name = 'verified_email'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consent_events' and column_name = 'submitted_email'
  ) then
    alter table public.consent_events rename column verified_email to submitted_email;
  end if;
end;
$$;

drop function if exists public.finalize_registration(
  text, text, text, text, text, integer, text,
  boolean, boolean, boolean, text, text, text
);

create or replace function public.finalize_registration(
  p_email text,
  p_first_name text,
  p_last_name text,
  p_school text,
  p_city text,
  p_class_name text,
  p_grade integer,
  p_ball_season text,
  p_terms_acknowledged boolean,
  p_age_confirmed boolean,
  p_marketing_consent boolean,
  p_rules_version text,
  p_privacy_version text,
  p_marketing_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_settings public.contest_settings%rowtype;
  v_existing jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select public.get_my_registration() into v_existing;
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_settings
  from public.contest_settings
  where slug = 'puls3-maturak-2026' and registration_enabled = true;

  if not found or now() < v_settings.starts_at or now() > v_settings.ends_at then
    raise exception 'REGISTRATION_CLOSED';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  p_first_name := btrim(regexp_replace(coalesce(p_first_name, ''), '\s+', ' ', 'g'));
  p_last_name := btrim(regexp_replace(coalesce(p_last_name, ''), '\s+', ' ', 'g'));
  p_school := btrim(regexp_replace(coalesce(p_school, ''), '\s+', ' ', 'g'));
  p_city := btrim(regexp_replace(coalesce(p_city, ''), '\s+', ' ', 'g'));
  p_class_name := btrim(regexp_replace(coalesce(p_class_name, ''), '\s+', ' ', 'g'));

  if char_length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or char_length(p_first_name) not between 1 and 60
     or char_length(p_last_name) not between 1 and 80
     or char_length(p_school) not between 2 and 180
     or char_length(p_city) not between 1 and 100
     or char_length(p_class_name) not between 1 and 30
     or p_grade is null
     or p_grade not in (3, 4)
     or p_ball_season is null
     or p_ball_season not in ('2026/2027', '2027/2028') then
    raise exception 'INVALID_REGISTRATION_DATA';
  end if;

  if p_terms_acknowledged is not true or p_age_confirmed is not true then
    raise exception 'REQUIRED_CONFIRMATION_MISSING';
  end if;

  if p_rules_version is distinct from v_settings.rules_version
     or p_privacy_version is distinct from v_settings.privacy_version
     or p_marketing_version is distinct from v_settings.marketing_version then
    raise exception 'DOCUMENT_VERSION_CHANGED';
  end if;

  if exists (select 1 from public.participants p where lower(p.email) = v_email) then
    raise exception 'EMAIL_ALREADY_REGISTERED';
  end if;

  insert into public.participants (
    user_id, contest_slug, email, first_name, last_name, school, city,
    class_name, grade, ball_season, email_verified_at
  ) values (
    v_user_id, v_settings.slug, v_email, p_first_name, p_last_name, p_school, p_city,
    p_class_name, p_grade, p_ball_season, null
  );

  insert into public.consent_events (
    user_id, contest_slug, consent_type, granted, document_version, submitted_email
  ) values
    (v_user_id, v_settings.slug, 'rules', true, v_settings.rules_version, v_email),
    (v_user_id, v_settings.slug, 'privacy_notice', true, v_settings.privacy_version, v_email),
    (v_user_id, v_settings.slug, 'age_confirmation', true, v_settings.rules_version, v_email),
    (v_user_id, v_settings.slug, 'marketing', coalesce(p_marketing_consent, false), v_settings.marketing_version, v_email);

  insert into public.marketing_preferences (
    user_id, contest_slug, email, consented, document_version, decided_at, consented_at
  ) values (
    v_user_id, v_settings.slug, v_email, coalesce(p_marketing_consent, false),
    v_settings.marketing_version, now(), case when p_marketing_consent then now() else null end
  );

  return public.get_my_registration();
end;
$$;

create or replace function public.withdraw_my_marketing_consent()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_version text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  update public.marketing_preferences
  set consented = false,
      withdrawn_at = now(),
      updated_at = now()
  where user_id = auth.uid() and consented = true
  returning email, document_version into v_email, v_version;

  if not found then return false; end if;

  update public.participants
  set digest_sent_at = null, updated_at = now()
  where user_id = auth.uid();

  insert into public.consent_events (
    user_id, contest_slug, consent_type, granted, document_version, submitted_email
  ) values (
    auth.uid(), 'puls3-maturak-2026', 'marketing', false, v_version, v_email
  );
  return true;
end;
$$;

-- Herní pokusy běží přes databázové API (na Free tarifu bez kvóty Edge Functions).
create or replace function public.start_game_attempt(
  p_contest_slug text,
  p_client_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
  v_settings public.contest_settings%rowtype;
  v_recent_count integer;
  v_attempt public.game_attempts%rowtype;
  v_seed bigint;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_contest_slug is distinct from 'puls3-maturak-2026'
     or char_length(coalesce(p_client_version, '')) not between 1 and 40 then
    raise exception 'INVALID_REQUEST';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select p.status into v_status
  from public.participants p
  where p.user_id = v_user_id and p.contest_slug = p_contest_slug;
  if not found or v_status <> 'active' then raise exception 'REGISTRATION_NOT_ACTIVE'; end if;

  select * into v_settings
  from public.contest_settings s
  where s.slug = p_contest_slug;
  if not found or not v_settings.scoring_enabled
     or now() < v_settings.starts_at or now() > v_settings.ends_at then
    raise exception 'SCORING_CLOSED';
  end if;

  select count(*)::integer into v_recent_count
  from public.game_attempts a
  where a.user_id = v_user_id
    and a.contest_slug = p_contest_slug
    and a.started_at >= now() - interval '1 minute';
  if v_recent_count >= 5 then raise exception 'TOO_MANY_ATTEMPTS'; end if;

  update public.game_attempts
  set status = 'expired', finished_at = now()
  where user_id = v_user_id
    and contest_slug = p_contest_slug
    and status = 'started';

  delete from public.game_attempts
  where user_id = v_user_id
    and contest_slug = p_contest_slug
    and status = 'expired';

  v_seed := floor(random() * 4294967295)::bigint;
  insert into public.game_attempts (user_id, contest_slug, seed, client_version)
  values (v_user_id, p_contest_slug, v_seed, p_client_version)
  returning * into v_attempt;

  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'seed', v_attempt.seed,
    'startedAt', v_attempt.started_at
  );
end;
$$;

create or replace function public.finish_game_attempt(
  p_contest_slug text,
  p_attempt_id uuid,
  p_score bigint,
  p_distance_score bigint,
  p_notes integer,
  p_duration_ms integer,
  p_jumps integer,
  p_client_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.game_attempts%rowtype;
  v_settings public.contest_settings%rowtype;
  v_finished_at timestamptz := clock_timestamp();
  v_server_elapsed_ms bigint;
  v_expected_score bigint;
  v_maximum_distance bigint;
  v_maximum_notes integer;
  v_maximum_jumps integer;
  v_risk_flags text[] := '{}';
  v_status text;
  v_best_score bigint;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_contest_slug is distinct from 'puls3-maturak-2026'
     or p_attempt_id is null
     or p_score is null or p_score < 0
     or p_distance_score is null or p_distance_score < 0
     or p_notes is null or p_notes < 0
     or p_duration_ms is null or p_duration_ms < 0 or p_duration_ms > 1800000
     or p_jumps is null or p_jumps < 0
     or char_length(coalesce(p_client_version, '')) not between 1 and 40 then
    raise exception 'INVALID_GAME_DATA';
  end if;

  select * into v_attempt
  from public.game_attempts a
  where a.id = p_attempt_id
    and a.user_id = v_user_id
    and a.contest_slug = p_contest_slug
  for update;
  if not found or v_attempt.status <> 'started' then raise exception 'ATTEMPT_NOT_ACTIVE'; end if;

  select * into v_settings
  from public.contest_settings s
  where s.slug = p_contest_slug;
  if not found then raise exception 'CONTEST_NOT_FOUND'; end if;

  v_server_elapsed_ms := greatest(
    0,
    floor(extract(epoch from (v_finished_at - v_attempt.started_at)) * 1000)::bigint
  );
  v_expected_score := p_distance_score + p_notes::bigint * 250;
  v_maximum_distance := floor((p_duration_ms::numeric / 1000) * 1200 * 0.076 + 500)::bigint;
  v_maximum_notes := ceil(p_duration_ms::numeric / 700)::integer + 3;
  v_maximum_jumps := ceil(p_duration_ms::numeric / 180)::integer + 4;

  if p_client_version <> v_attempt.client_version then v_risk_flags := array_append(v_risk_flags, 'client_version_mismatch'); end if;
  if not v_settings.scoring_enabled then v_risk_flags := array_append(v_risk_flags, 'scoring_disabled'); end if;
  if v_finished_at > v_settings.ends_at + interval '15 seconds' then v_risk_flags := array_append(v_risk_flags, 'finished_after_contest'); end if;
  if p_duration_ms < 1500 then v_risk_flags := array_append(v_risk_flags, 'invalid_duration'); end if;
  if p_duration_ms::bigint > v_server_elapsed_ms + 3000 then v_risk_flags := array_append(v_risk_flags, 'client_time_ahead'); end if;
  if v_server_elapsed_ms > 3600000 then v_risk_flags := array_append(v_risk_flags, 'attempt_too_old'); end if;
  if p_score <> v_expected_score then v_risk_flags := array_append(v_risk_flags, 'score_formula_mismatch'); end if;
  if p_distance_score > v_maximum_distance then v_risk_flags := array_append(v_risk_flags, 'distance_too_high'); end if;
  if p_notes > v_maximum_notes then v_risk_flags := array_append(v_risk_flags, 'notes_too_high'); end if;
  if p_jumps > v_maximum_jumps then v_risk_flags := array_append(v_risk_flags, 'jump_rate_too_high'); end if;
  if p_score > 10000 and p_duration_ms < 15000 then v_risk_flags := array_append(v_risk_flags, 'score_too_fast'); end if;

  v_status := case when cardinality(v_risk_flags) = 0 then 'valid' else 'flagged' end;
  update public.game_attempts
  set status = v_status,
      finished_at = v_finished_at,
      duration_ms = p_duration_ms,
      server_elapsed_ms = least(v_server_elapsed_ms, 3600000)::integer,
      score = p_score,
      distance_score = p_distance_score,
      notes = p_notes,
      jumps = p_jumps,
      risk_flags = v_risk_flags
  where id = p_attempt_id;

  if v_status = 'valid' then
    perform public.record_valid_score(p_attempt_id);

    -- Pro každého hráče stačí uchovat pokus s jeho nejlepším skóre.
    -- Tím databáze neroste s každou opakovanou hrou.
    delete from public.game_attempts a
    where a.user_id = v_user_id
      and a.contest_slug = p_contest_slug
      and a.status = 'valid'
      and a.id <> (
        select b.attempt_id
        from public.best_scores b
        where b.user_id = v_user_id and b.contest_slug = p_contest_slug
      );
  else
    -- Pro ruční kontrolu ponechat nejvýše 20 posledních podezřelých pokusů hráče.
    delete from public.game_attempts a
    where a.id in (
      select old_attempt.id
      from public.game_attempts old_attempt
      where old_attempt.user_id = v_user_id
        and old_attempt.contest_slug = p_contest_slug
        and old_attempt.status = 'flagged'
      order by old_attempt.finished_at desc
      offset 20
    );
  end if;

  select coalesce((
    select b.best_score from public.best_scores b
    where b.contest_slug = p_contest_slug and b.user_id = v_user_id
  ), 0) into v_best_score;

  return jsonb_build_object(
    'accepted', v_status = 'valid',
    'score', p_score,
    'bestScore', v_best_score
  );
end;
$$;

-- Data pro jeden souhrnný e-mail. Funkce je dostupná jen serverovému secret key.
create or replace function public.pending_registration_digest(p_limit integer default 5000)
returns table (
  user_id uuid,
  registered_at timestamptz,
  first_name text,
  last_name text,
  email text,
  school text,
  city text,
  class_name text,
  grade smallint,
  ball_season text,
  marketing_consent boolean,
  best_score bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.user_id,
    p.registered_at,
    p.first_name,
    p.last_name,
    p.email,
    p.school,
    p.city,
    p.class_name,
    p.grade,
    p.ball_season,
    coalesce(m.consented, false),
    coalesce(b.best_score, 0)
  from public.participants p
  left join public.marketing_preferences m on m.user_id = p.user_id
  left join public.best_scores b on b.user_id = p.user_id and b.contest_slug = p.contest_slug
  where p.contest_slug = 'puls3-maturak-2026'
    and p.digest_sent_at is null
  order by p.registered_at asc
  limit greatest(1, least(coalesce(p_limit, 5000), 10000));
$$;

create or replace function public.mark_registration_digest_sent(p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.participants
  set digest_sent_at = now(), updated_at = now()
  where user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
    and digest_sent_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.finalize_registration(
  text, text, text, text, text, text, integer, text,
  boolean, boolean, boolean, text, text, text
) from public, anon;
revoke all on function public.start_game_attempt(text, text) from public, anon;
revoke all on function public.finish_game_attempt(text, uuid, bigint, bigint, integer, integer, integer, text) from public, anon;
revoke all on function public.pending_registration_digest(integer) from public, anon, authenticated;
revoke all on function public.mark_registration_digest_sent(uuid[]) from public, anon, authenticated;

grant execute on function public.finalize_registration(
  text, text, text, text, text, text, integer, text,
  boolean, boolean, boolean, text, text, text
) to authenticated;
grant execute on function public.start_game_attempt(text, text) to authenticated;
grant execute on function public.finish_game_attempt(text, uuid, bigint, bigint, integer, integer, integer, text) to authenticated;
grant execute on function public.pending_registration_digest(integer) to service_role;
grant execute on function public.mark_registration_digest_sent(uuid[]) to service_role;

commit;
