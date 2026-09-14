#!/usr/bin/env python3
import base64
import csv
import io
import json
import os
import smtplib
import ssl
import urllib.error
import urllib.request
from datetime import datetime
from email.message import EmailMessage
from zoneinfo import ZoneInfo


SUPABASE_URL = "https://ekqtxhoynvjzlwmxcoek.supabase.co"
CONTEST_SLUG = "puls3-maturak-2026"
MAILBOX = "booking@puls3.cz"


def required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Chybí GitHub Secret {name}.")
    return value


def supabase_rpc(name, payload, secret_key):
    request = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{name}",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "apikey": secret_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:1000]
        raise RuntimeError(f"Supabase RPC {name} selhalo ({error.code}): {detail}") from error


def safe_csv_value(value):
    text = "" if value is None else str(value)
    if text.startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def create_csv(rows):
    columns = [
        ("registrovano", "registered_at"),
        ("jmeno", "first_name"),
        ("prijmeni", "last_name"),
        ("email", "email"),
        ("skola", "school"),
        ("mesto", "city"),
        ("trida", "class_name"),
        ("rocnik", "grade"),
        ("obdobi_plesu", "ball_season"),
        ("marketing_souhlas", "marketing_consent"),
        ("nejlepsi_skore_v_case_souhrnu", "best_score"),
    ]
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writerow([label for label, _ in columns])
    for row in rows:
        values = []
        for _, key in columns:
            value = row.get(key)
            if key == "marketing_consent":
                value = "ANO" if value else "NE"
            values.append(safe_csv_value(value))
        writer.writerow(values)
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def send_mail(rows, csv_bytes, resend_api_key):
    now = datetime.now(ZoneInfo("Europe/Prague"))
    payload = {
        "from": "PULS3 soutěž <registrace@soutez.puls3.cz>",
        "to": [MAILBOX],
        "subject": f"PULS3 – {len(rows)} nových nebo změněných registrací – {now:%d. %m. %Y %H:%M}",
        "text": (
            "V příloze je souhrn nových nebo změněných registrací do soutěže PULS3.\n\n"
            f"Počet záznamů: {len(rows)}\n"
            "Soubor obsahuje kontaktní údaje, školu, třídu, období plesu, "
            "marketingový souhlas a aktuální nejlepší skóre.\n\n"
            "Jde o automatickou zprávu; osobní údaje chraňte před neoprávněným přístupem."
        ),
        "attachments": [{
            "filename": f"puls3-registrace-{now:%Y-%m-%d-%H%M}.csv",
            "content": base64.b64encode(csv_bytes).decode("ascii"),
        }],
    }
    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {resend_api_key}",
            "Content-Type": "application/json",
            "User-Agent": "PULS3-registration-digest/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:1000]
        raise RuntimeError(f"Resend odeslání selhalo ({error.code}): {detail}") from error


def main():
    secret_key = required_env("SUPABASE_SECRET_KEY")
    resend_api_key = required_env("RESEND_API_KEY")

    rows = supabase_rpc("pending_registration_digest", {"p_limit": 5000}, secret_key) or []
    if not rows:
        print("Žádné nové registrace; e-mail se neposílá.")
        return

    csv_bytes = create_csv(rows)
    send_mail(rows, csv_bytes, resend_api_key)
    user_ids = [row["user_id"] for row in rows]
    marked = supabase_rpc("mark_registration_digest_sent", {"p_user_ids": user_ids}, secret_key)
    print(f"Souhrn odeslán; označeno registrací: {marked}.")


if __name__ == "__main__":
    main()
