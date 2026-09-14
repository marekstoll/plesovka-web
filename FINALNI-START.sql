update public.contest_settings
set starts_at = '2026-09-14 00:01:00+02',
    ends_at = '2026-09-30 23:59:59+02',
    registration_enabled = true,
    scoring_enabled = true,
    updated_at = now()
where slug = 'puls3-maturak-2026';

select slug, starts_at, ends_at, registration_enabled, scoring_enabled
from public.contest_settings
where slug = 'puls3-maturak-2026';
