(() => {
  "use strict";

  const config = window.PULS3_CONTEST_CONFIG || {};
  const loginPanel = document.getElementById("loginPanel");
  const dashboard = document.getElementById("dashboard");
  const loginForm = document.getElementById("adminLoginForm");
  const loginMessage = document.getElementById("loginMessage");
  const adminMessage = document.getElementById("adminMessage");
  const signOutButton = document.getElementById("signOutButton");
  const participantsBody = document.getElementById("participantsBody");
  const attemptsBody = document.getElementById("attemptsBody");
  const participantSearch = document.getElementById("participantSearch");
  const captchaContainer = document.getElementById("adminCaptchaContainer");
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || "") &&
    !String(config.supabaseUrl || "").includes("DOPLNIT") &&
    !String(config.supabasePublishableKey || "").startsWith("DOPLNIT");
  const client = configured && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          persistSession: true,
          detectSessionInUrl: true,
          flowType: "pkce",
          storageKey: "puls3-contest-admin-auth"
        }
      })
    : null;
  let searchTimer = 0;
  let captchaWidgetId = null;

  function captchaEnabled() {
    return typeof config.turnstileSiteKey === "string" && !config.turnstileSiteKey.startsWith("DOPLNIT");
  }

  function setupCaptcha() {
    if (!captchaEnabled()) return;
    captchaContainer.hidden = false;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      captchaWidgetId = window.turnstile.render(captchaContainer, {
        sitekey: config.turnstileSiteKey,
        theme: "dark",
        language: "cs"
      });
    });
    document.head.appendChild(script);
  }

  function setMessage(message) {
    adminMessage.textContent = message;
  }

  function textCell(value, className = "") {
    const cell = document.createElement("td");
    cell.textContent = String(value ?? "");
    if (className) cell.className = className;
    return cell;
  }

  function emptyRow(target, columns, message) {
    target.replaceChildren();
    const row = document.createElement("tr");
    const cell = textCell(message, "empty-cell");
    cell.colSpan = columns;
    row.appendChild(cell);
    target.appendChild(row);
  }

  async function checkAdmin() {
    if (!client) {
      loginMessage.textContent = "Nejdřív doplň připojení k databázi v souboru config.js.";
      return false;
    }
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) return false;
    const { data, error } = await client.rpc("is_current_user_admin");
    if (error || !data) {
      loginMessage.textContent = "Tento účet nemá administrátorské oprávnění.";
      await client.auth.signOut();
      return false;
    }
    loginPanel.hidden = true;
    dashboard.hidden = false;
    signOutButton.hidden = false;
    if (window.location.search.includes("code=")) {
      history.replaceState({}, document.title, `${location.origin}${location.pathname}`);
    }
    await loadDashboard();
    return true;
  }

  async function login(event) {
    event.preventDefault();
    if (!client) {
      loginMessage.textContent = "Databáze zatím není připojená.";
      return;
    }
    const formData = new FormData(loginForm);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    const captchaToken = captchaEnabled() && captchaWidgetId !== null
      ? window.turnstile.getResponse(captchaWidgetId)
      : undefined;
    if (captchaEnabled() && !captchaToken) {
      loginMessage.textContent = "Potvrď bezpečnostní kontrolu.";
      return;
    }
    loginMessage.textContent = "Přihlašuji…";
    try {
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken }
      });
      loginMessage.textContent = error ? "Nesprávný e-mail nebo heslo." : "Přihlášení proběhlo.";
    } catch (error) {
      console.error(error);
      loginMessage.textContent = "Přihlášení se nepodařilo. Zkontroluj připojení.";
    } finally {
      if (captchaEnabled() && captchaWidgetId !== null) window.turnstile.reset(captchaWidgetId);
    }
  }

  async function loadDashboard() {
    setMessage("Načítám data…");
    try {
      await Promise.all([loadSummary(), loadParticipants(), loadFlaggedAttempts()]);
      setMessage("");
    } catch (error) {
      console.error(error);
      setMessage("Data se nepodařilo načíst. Zkontroluj připojení a oprávnění účtu.");
    }
  }

  async function loadSummary() {
    const { data, error } = await client.rpc("admin_contest_summary");
    if (error) throw error;
    document.getElementById("summaryPlayers").textContent = Number(data.players || 0).toLocaleString("cs-CZ");
    document.getElementById("summaryAttempts").textContent = Number(data.valid_attempts || 0).toLocaleString("cs-CZ");
    document.getElementById("summaryFlagged").textContent = Number(data.flagged_attempts || 0).toLocaleString("cs-CZ");
    document.getElementById("summaryMarketing").textContent = Number(data.marketing_yes || 0).toLocaleString("cs-CZ");
  }

  async function loadParticipants() {
    const { data, error } = await client.rpc("admin_list_participants", {
      p_search: participantSearch.value.trim(),
      p_limit: 500,
      p_offset: 0
    });
    if (error) throw error;
    renderParticipants(data || []);
  }

  function renderParticipants(rows) {
    participantsBody.replaceChildren();
    if (!rows.length) return emptyRow(participantsBody, 7, "Žádní odpovídající účastníci.");
    for (const item of rows) {
      const row = document.createElement("tr");
      const person = textCell(`${item.first_name} ${item.last_name}`);
      const personMeta = document.createElement("small");
      personMeta.textContent = `${item.grade}. ročník · ${item.class_name} · ${item.ball_season}`;
      person.appendChild(personMeta);
      row.appendChild(person);
      row.appendChild(textCell(`${item.school} · ${item.city}`));
      row.appendChild(textCell(item.email));
      row.appendChild(textCell(Number(item.best_score || 0).toLocaleString("cs-CZ")));
      row.appendChild(textCell(item.marketing_consent ? "ANO" : "NE"));
      row.appendChild(textCell(item.status, item.status === "active" ? "status-active" : "status-disabled"));

      const actions = document.createElement("td");
      actions.className = "row-actions";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = item.status === "active" ? "Zablokovat" : "Aktivovat";
      toggle.addEventListener("click", () => setParticipantStatus(item.user_id, item.status === "active" ? "disabled" : "active"));
      actions.appendChild(toggle);
      row.appendChild(actions);
      participantsBody.appendChild(row);
    }
  }

  async function setParticipantStatus(userId, status) {
    const { error } = await client.rpc("admin_set_participant_status", { p_user_id: userId, p_status: status });
    if (error) return setMessage("Změnu se nepodařilo uložit.");
    await loadDashboard();
  }

  async function loadFlaggedAttempts() {
    const { data, error } = await client.rpc("admin_list_flagged_attempts", { p_limit: 300 });
    if (error) throw error;
    attemptsBody.replaceChildren();
    if (!(data || []).length) return emptyRow(attemptsBody, 6, "Žádné pokusy nečekají na kontrolu.");
    for (const item of data) {
      const row = document.createElement("tr");
      row.appendChild(textCell(`${item.first_name} ${item.last_name}\n${item.school}`));
      row.appendChild(textCell(Number(item.score || 0).toLocaleString("cs-CZ")));
      row.appendChild(textCell(`${Math.round(Number(item.duration_ms || 0) / 1000)} s`));
      row.appendChild(textCell((item.risk_flags || []).join(", "), "flag-list"));
      row.appendChild(textCell(new Date(item.finished_at).toLocaleString("cs-CZ")));
      const actions = document.createElement("td");
      actions.className = "row-actions";
      for (const [label, approved] of [["Uznat", true], ["Zamítnout", false]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => reviewAttempt(item.attempt_id, approved));
        actions.appendChild(button);
      }
      row.appendChild(actions);
      attemptsBody.appendChild(row);
    }
  }

  async function reviewAttempt(attemptId, approved) {
    const { error } = await client.rpc("admin_review_attempt", { p_attempt_id: attemptId, p_approve: approved });
    if (error) return setMessage("Rozhodnutí se nepodařilo uložit.");
    await loadDashboard();
  }

  function csvCell(value) {
    let safeValue = String(value ?? "");
    if (/^[=+\-@]/.test(safeValue)) safeValue = `'${safeValue}`;
    return `"${safeValue.replace(/"/g, '""')}"`;
  }

  async function exportCsv() {
    const { data, error } = await client.rpc("admin_export_participants");
    if (error) return setMessage("Export se nepodařilo vytvořit.");
    const columns = ["jmeno", "prijmeni", "email", "skola", "mesto", "trida", "rocnik", "obdobi_plesu", "nejlepsi_skore", "marketing_souhlas", "marketing_verze", "marketing_cas", "registrace", "stav"];
    const lines = [columns.join(";")];
    for (const item of data || []) lines.push(columns.map((column) => csvCell(item[column])).join(";"));
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `puls3-soutez-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  loginForm.addEventListener("submit", login);
  signOutButton.addEventListener("click", async () => {
    await client?.auth.signOut();
    location.reload();
  });
  document.getElementById("refreshAdminButton").addEventListener("click", loadDashboard);
  document.getElementById("exportCsvButton").addEventListener("click", exportCsv);
  participantSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadParticipants, 350);
  });

  if (client) {
    client.auth.onAuthStateChange((_event, session) => {
      if (session) setTimeout(checkAdmin, 0);
    });
  }
  setupCaptcha();
  checkAdmin().catch((error) => {
    console.error(error);
    loginMessage.textContent = "Přihlášení se nepodařilo ověřit. Zkus stránku načíst znovu.";
  });
})();
