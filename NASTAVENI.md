# Nastavení soutěže PULS3

## Výsledek této verze

- registrace hráče neodesílá ověřovací e-mail a po uložení rovnou otevře hru;
- jméno, příjmení, e-mail, škola, město, třída, ročník, období plesu a marketingová volba se ukládají v Supabase;
- všechny pokusy i nejlepší skóre se ukládají v Supabase;
- jednou za hodinu může přijít na `booking@puls3.cz` jediný e-mail s CSV přílohou obsahující všechny nové registrace;
- hráčův e-mail není technicky ověřený a anonymní herní účet zůstává svázaný s prohlížečem, dokud hráč nevymaže jeho data nebo se neodhlásí;
- používají se bezplatné možnosti Supabase, Cloudflare Turnstile a GitHub Actions ve veřejném repozitáři.

## 1. Změna existujícího Supabase projektu

1. V `Authentication → Sign In / Providers` zapni **Allow anonymous sign-ins** a ulož změnu. **Confirm email** může zůstat zapnuté; hráčská registrace ho nepoužívá.
2. V `SQL Editor` spusť celý soubor `supabase/migrations/202609130002_anonymous_registration.sql`.
3. V `Authentication → Rate Limits` nastav **Anonymous sign-ins** alespoň na počet registrací, které chceš přijmout z jedné IP adresy za hodinu. Pro hromadné hraní ze školní sítě doporučujeme `1000`. Ochranu Cloudflare Turnstile nech zapnutou.
4. Staré Edge Functions `start-attempt` a `finish-attempt` mohou v projektu zůstat. Nový web je nevolá; pokusy ukládá přes chráněné databázové funkce.

Pokud se zakládá úplně nový Supabase projekt, spusť nejprve migraci `202609110001_puls3_contest.sql` a potom `202609130002_anonymous_registration.sql`.

## 2. Soubory webu

Do repozitáře nahraj změněné soubory a zachovej jejich adresáře:

- `soutez/app.js`
- `soutez/index.html`
- `soutez/pravidla/index.html`
- `soutez/gdpr/index.html`
- `soutez/admin/index.html`
- `soutez/admin/admin.js`
- `.github/scripts/send-registration-digest.py`
- `.github/workflows/registration-digest.yml`

Soubor `soutez/config.js` s funkčními klíči nemaž ani nepřepisuj šablonou. Pro ostrý start v něm musí být:

```js
startsAt: "2026-09-14T00:01:00+02:00",
```

Publishable key smí být ve veřejném webu. Secret key nesmí být v žádném souboru repozitáře.

## 3. Hodinový e-mail s kontakty

V GitHub repozitáři otevři `Settings → Secrets and variables → Actions` a jako **Repository secrets** přidej:

- `SUPABASE_SECRET_KEY` – nový serverový klíč začínající `sb_secret_`; nikdy ho nevkládej do kódu;
- `SMTP_HOST` – SMTP server schránky `booking@puls3.cz` uvedený v nastavení WEDOS;
- `SMTP_PASSWORD` – heslo schránky `booking@puls3.cz`;
- `SMTP_PORT` – `465` (nepovinné, 465 se použije automaticky).

Workflow běží v 7. minutě každé hodiny. Když nejsou nové ani změněné registrace, neposílá nic. Když jich je například 1000, odešle jeden e-mail s jednou CSV přílohou. Údaje označí jako odeslané až po úspěšném odeslání e-mailu. Odvolání marketingového souhlasu zařadí danou registraci znovu s aktuální hodnotou `NE`.

První test lze spustit ručně přes `GitHub → Actions → PULS3 registration digest → Run workflow`.

## 4. Administrace bez e-mailových odkazů

Administrace je na `https://puls3.cz/soutez/admin/` a nyní používá e-mail a heslo.

1. V Supabase `Authentication → Users` vytvoř stálý účet `booking@puls3.cz` s bezpečným heslem a označ ho jako potvrzený.
2. V SQL Editoru jednou spusť:

```sql
insert into public.admin_users (user_id)
select id from auth.users where lower(email) = lower('booking@puls3.cz') and is_anonymous is false
on conflict (user_id) do nothing;
```

V administraci jsou všechny kontaktní údaje, marketingová volba, nejlepší skóre, blokace hráčů, podezřelé pokusy a ruční CSV export.

## 5. Test a návrat ostrého termínu

Po testu změň `startsAt` v živém `soutez/config.js` na `2026-09-14T00:01:00+02:00` a v SQL Editoru spusť soubor `FINALNI-START.sql`.

Před zveřejněním otestuj registraci v anonymním okně prohlížeče, jeden celý pokus, zobrazení nejlepšího skóre, administraci a ručně spuštěný hodinový e-mail. Na telefonu otestuj dotykové ovládání a otočení obrazovky.

## 6. Potvrzené údaje soutěže

- soutěž: **14. 9. 2026 00:01 – 30. 9. 2026 23:59**;
- převzetí výhry nejpozději **14. 10. 2026 23:59**;
- plesy v období **2026/2027 nebo 2027/2028**;
- pořadatel: **Marek Štolle, IČO 08373043, Nad Školou 169, 257 63 Trhový Štěpánov**;
- účastník musí mít při registraci nejméně 18 let a být ve 3. nebo 4. ročníku SŠ;
- doprava kapely po České republice je součástí výhry;
- ozvučení, osvětlení, pódium, elektrické připojení a další technické zajištění nejsou součástí výhry.

Finální pravidla, ochranu osobních údajů a daňové posouzení výhry je vhodné nechat zkontrolovat právníkem a účetním.
