(() => {
  "use strict";

  const config = window.PULS3_CONTEST_CONFIG || {};
  const views = Array.from(document.querySelectorAll("[data-view]"));
  const landingView = document.getElementById("landingView");
  const registrationView = document.getElementById("registrationView");
  const gameView = document.getElementById("gameView");
  const leaderboardSection = document.getElementById("leaderboardSection");
  const leaderboardBody = document.getElementById("leaderboardBody");
  const registeredCount = document.getElementById("registeredCount");
  const registrationForm = document.getElementById("registrationForm");
  const registrationMessage = document.getElementById("registrationMessage");
  const registrationSubmitButton = document.getElementById("registrationSubmitButton");
  const registrationPreviewNote = document.getElementById("registrationPreviewNote");
  const playerName = document.getElementById("playerName");
  const toast = document.getElementById("toast");
  const withdrawMarketingButton = document.getElementById("withdrawMarketingButton");
  const withdrawSeparator = document.getElementById("withdrawSeparator");
  const playerSignOutButton = document.getElementById("playerSignOutButton");
  const sessionSeparator = document.getElementById("sessionSeparator");
  const captchaContainer = document.getElementById("captchaContainer");

  const isConfigured =
    typeof config.supabaseUrl === "string" &&
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl) &&
    !config.supabaseUrl.includes("DOPLNIT") &&
    typeof config.supabasePublishableKey === "string" &&
    !config.supabasePublishableKey.startsWith("DOPLNIT");

  const client = isConfigured && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          persistSession: true,
          detectSessionInUrl: true,
          flowType: "pkce",
          storageKey: "puls3-contest-player-auth"
        }
      })
    : null;

  let session = null;
  let registration = null;
  let activeAttempt = null;
  let toastTimer = 0;
  let hydrating = false;
  let registrationSubmissionInProgress = false;
  let captchaWidgetId = null;

  function showView(name) {
    for (const view of views) view.hidden = view.dataset.view !== name;
    window.scrollTo({ top: 0, behavior: "auto" });
    if (name === "game") {
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    }
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 4500);
  }

  function setRegistrationMessage(message, success = false) {
    registrationMessage.textContent = message;
    registrationMessage.classList.toggle("is-success", success);
  }

  function contestPhase() {
    const now = Date.now();
    const starts = Date.parse(config.startsAt);
    const ends = Date.parse(config.endsAt);
    if (!Number.isFinite(starts) || !Number.isFinite(ends)) return "closed";
    if (now < starts) return "before";
    if (now > ends) return "after";
    return "open";
  }

  function configureRegistrationAvailability() {
    const phase = contestPhase();
    if (phase === "before") {
      registrationPreviewNote.hidden = false;
      registrationPreviewNote.textContent = "Náhled registračního formuláře. Registraci bude možné odeslat od 14. září 2026.";
      registrationSubmitButton.disabled = true;
      registrationSubmitButton.textContent = "REGISTRACE OD 14. 9. 2026";
      return;
    }
    if (phase === "after") {
      registrationPreviewNote.hidden = false;
      registrationPreviewNote.textContent = "Registrace do této soutěže už skončila.";
      registrationSubmitButton.disabled = true;
      registrationSubmitButton.textContent = "REGISTRACE UKONČENA";
      return;
    }
    registrationPreviewNote.hidden = true;
    registrationPreviewNote.textContent = "";
    registrationSubmitButton.disabled = false;
    registrationSubmitButton.textContent = "REGISTROVAT A HRÁT";
  }

  function normalizeText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function registrationPayload(form) {
    const data = new FormData(form);
    return {
      first_name: normalizeText(data.get("first_name")),
      last_name: normalizeText(data.get("last_name")),
      school: normalizeText(data.get("school")),
      city: normalizeText(data.get("city")),
      class_name: normalizeText(data.get("class_name")),
      grade: Number(data.get("grade")),
      ball_season: normalizeText(data.get("ball_season")),
      email: normalizeText(data.get("email")).toLowerCase(),
      terms_acknowledged: data.get("terms_acknowledged") === "on",
      age_confirmed: data.get("age_confirmed") === "on",
      marketing_consent: data.get("marketing_consent") === "on",
      rules_version: config.rulesVersion,
      privacy_version: config.privacyVersion,
      marketing_version: config.marketingVersion
    };
  }

  function validatePayload(payload) {
    if (!payload.first_name || !payload.last_name || !payload.school || !payload.city || !payload.class_name) {
      return "Vyplň prosím všechna textová pole.";
    }
    if (![3, 4].includes(payload.grade)) return "Vyber 3. nebo 4. ročník.";
    if (!["2026/2027", "2027/2028"].includes(payload.ball_season)) return "Vyber období maturitního plesu.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return "Zadej platnou e-mailovou adresu.";
    if (!payload.terms_acknowledged) return "Pro účast musíš přijmout pravidla a potvrdit seznámení s informacemi o zpracování osobních údajů.";
    if (!payload.age_confirmed) return "Soutěž je určená pouze hráčům, kteří dovršili 18 let.";
    return "";
  }

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

  async function getRegistration() {
    if (!client || !session) return null;
    const { data, error } = await client.rpc("get_my_registration");
    if (error) throw error;
    return data || null;
  }

  async function finalizeRegistration(payload) {
    const { data, error } = await client.rpc("finalize_registration", {
      p_email: payload.email,
      p_first_name: payload.first_name,
      p_last_name: payload.last_name,
      p_school: payload.school,
      p_city: payload.city,
      p_class_name: payload.class_name,
      p_grade: payload.grade,
      p_ball_season: payload.ball_season,
      p_terms_acknowledged: payload.terms_acknowledged,
      p_age_confirmed: payload.age_confirmed,
      p_marketing_consent: payload.marketing_consent,
      p_rules_version: payload.rules_version,
      p_privacy_version: payload.privacy_version,
      p_marketing_version: payload.marketing_version
    });
    if (error) throw error;
    return data;
  }

  async function hydrateAuthenticatedUser() {
    if (!client || hydrating) return;
    hydrating = true;

    try {
      const result = await client.auth.getSession();
      session = result.data.session;
      if (!session) return;
      registration = await getRegistration();
      if (registration) {
        playerName.textContent = `${registration.first_name} · ${registration.school}`;
        withdrawMarketingButton.hidden = !registration.marketing_consent;
        withdrawSeparator.hidden = !registration.marketing_consent;
        playerSignOutButton.hidden = false;
        sessionSeparator.hidden = false;
        loadRegisteredCount();
        showView("game");
        showToast("Registrace je hotová. Můžeš hrát.");
      }
    } catch (error) {
      console.error(error);
      showView("registration");
      setRegistrationMessage("Registraci se nepodařilo načíst. Obnov stránku a zkus to znovu.");
    } finally {
      hydrating = false;
    }
  }

  async function submitRegistration(event) {
    event.preventDefault();
    setRegistrationMessage("");
    if (contestPhase() !== "open") {
      setRegistrationMessage(contestPhase() === "before"
        ? "Registrace se otevře 14. září 2026."
        : "Registrace do této soutěže už skončila.");
      return;
    }
    const payload = registrationPayload(registrationForm);
    const validationError = validatePayload(payload);
    if (validationError) {
      setRegistrationMessage(validationError);
      return;
    }
    if (!client) {
      setRegistrationMessage("Registrace zatím není připojená k databázi. Dokonči nastavení podle přiloženého návodu.");
      return;
    }

    const captchaToken = captchaEnabled() && captchaWidgetId !== null
      ? window.turnstile.getResponse(captchaWidgetId)
      : undefined;
    if (captchaEnabled() && !captchaToken) {
      setRegistrationMessage("Potvrď prosím bezpečnostní kontrolu.");
      return;
    }

    registrationSubmitButton.disabled = true;
    registrationSubmitButton.textContent = "REGISTRUJI…";
    registrationSubmissionInProgress = true;

    try {
      if (!session) {
        const { data: authData, error: authError } = await client.auth.signInAnonymously({
          options: { captchaToken }
        });
        if (authError) throw authError;
        session = authData.session;
      }
      if (!session) throw new Error("AUTH_SESSION_MISSING");

      registration = await finalizeRegistration(payload);
      playerName.textContent = `${registration.first_name} · ${registration.school}`;
      withdrawMarketingButton.hidden = !registration.marketing_consent;
      withdrawSeparator.hidden = !registration.marketing_consent;
      playerSignOutButton.hidden = false;
      sessionSeparator.hidden = false;
      registrationForm.reset();
      showView("game");
      showToast("Registrace je uložená. Můžeš hrát.");
      loadRegisteredCount();
    } catch (error) {
      console.error(error);
      if (error?.code === "23505" || /EMAIL_ALREADY_REGISTERED/.test(error?.message || "")) {
        setRegistrationMessage("Tento e-mail už je v soutěži zaregistrovaný.");
      } else if (error?.status === 429 || /rate limit/i.test(error?.message || "")) {
        setRegistrationMessage("Z této sítě právě proběhlo příliš mnoho registrací. Zkus to za chvíli znovu.");
      } else {
        setRegistrationMessage("Registraci se nepodařilo uložit. Zkus to prosím znovu.");
      }
    } finally {
      registrationSubmissionInProgress = false;
      if (captchaEnabled() && captchaWidgetId !== null) window.turnstile.reset(captchaWidgetId);
      configureRegistrationAvailability();
    }
  }

  async function loadLeaderboard() {
    if (!client) {
      leaderboardBody.innerHTML = '<tr><td class="table-message" colspan="5">Žebříček se zobrazí po připojení databáze.</td></tr>';
      return;
    }
    leaderboardBody.innerHTML = '<tr><td class="table-message" colspan="5">Načítám žebříček…</td></tr>';
    try {
      const { data, error } = await client.rpc("public_leaderboard", { p_limit: 100 });
      if (error) throw error;
      renderLeaderboard(data || []);
    } catch (error) {
      console.error(error);
      leaderboardBody.innerHTML = '<tr><td class="table-message" colspan="5">Žebříček se nyní nepodařilo načíst.</td></tr>';
    }
  }

  function renderLeaderboard(rows) {
    leaderboardBody.replaceChildren();
    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "table-message";
      cell.textContent = "Zatím tu není žádné platné skóre.";
      row.appendChild(cell);
      leaderboardBody.appendChild(row);
      return;
    }

    for (const item of rows) {
      const row = document.createElement("tr");
      const values = [item.rank, item.player_name, item.school, item.city, Number(item.score).toLocaleString("cs-CZ")];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value ?? "");
        row.appendChild(cell);
      }
      leaderboardBody.appendChild(row);
    }
  }

  async function loadRegisteredCount() {
    if (!client) {
      registeredCount.textContent = "0";
      return;
    }
    try {
      const { data, error } = await client.rpc("contest_registered_count");
      if (error) throw error;
      registeredCount.textContent = Number(data || 0).toLocaleString("cs-CZ");
    } catch {
      registeredCount.textContent = "—";
    }
  }

  async function beginAttempt() {
    if (!registration) {
      showView("registration");
      return null;
    }
    if (contestPhase() !== "open") {
      showToast(contestPhase() === "before" ? "Soutěž ještě nezačala. Tento pokus bude pouze tréninkový." : "Soutěž už skončila. Tento pokus bude pouze tréninkový.");
      activeAttempt = { practice: true };
      return activeAttempt;
    }
    try {
      const { data, error } = await client.rpc("start_game_attempt", {
        p_contest_slug: config.contestSlug,
        p_client_version: config.clientVersion
      });
      if (error) throw error;
      activeAttempt = data;
      return activeAttempt;
    } catch (error) {
      console.error(error);
      showToast(error.message || "Pokus se nepodařilo zahájit.");
      return null;
    }
  }

  async function finishAttempt(result) {
    if (!activeAttempt) return { accepted: false, message: "Pokus nebyl zahájen." };
    if (activeAttempt.practice) {
      activeAttempt = null;
      return { accepted: false, practice: true, message: "Tréninkové skóre se do žebříčku neukládá." };
    }
    try {
      const { data: response, error } = await client.rpc("finish_game_attempt", {
        p_contest_slug: config.contestSlug,
        p_attempt_id: activeAttempt.attemptId,
        p_score: result.score,
        p_distance_score: result.distanceScore,
        p_notes: result.notes,
        p_duration_ms: result.durationMs,
        p_jumps: result.jumps,
        p_client_version: config.clientVersion
      });
      if (error) throw error;
      activeAttempt = null;
      if (response.accepted) {
        loadLeaderboard();
        return { accepted: true, message: "Skóre bylo ověřeno a uloženo." };
      }
      return { accepted: false, message: "Skóre čeká na kontrolu a zatím se v žebříčku nezobrazuje." };
    } catch (error) {
      console.error(error);
      activeAttempt = null;
      return { accepted: false, message: "Skóre se nepodařilo uložit. Zkontroluj připojení." };
    }
  }

  function openContestEntry() {
    if (registration) {
      showView("game");
      return;
    }
    configureRegistrationAvailability();
    showView("registration");
  }

  function showLeaderboard() {
    showView("landing");
    window.setTimeout(() => leaderboardSection.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  }

  async function withdrawMarketingConsent() {
    if (!client || !registration?.marketing_consent) return;
    if (!window.confirm("Opravdu chceš odvolat souhlas se zasláním zvýhodněné nabídky?")) return;
    const { error } = await client.rpc("withdraw_my_marketing_consent");
    if (error) {
      showToast("Souhlas se nepodařilo odvolat. Napiš na booking@puls3.cz.");
      return;
    }
    registration.marketing_consent = false;
    withdrawMarketingButton.hidden = true;
    withdrawSeparator.hidden = true;
    showToast("Marketingový souhlas byl odvolán.");
  }

  async function signOutPlayer() {
    if (!client) return;
    if (!window.confirm("Po odhlášení už tento anonymní herní účet nepůjde obnovit. Opravdu se chceš odhlásit?")) return;
    window.PULS3Game?.pauseIfRunning();
    await client.auth.signOut();
    session = null;
    registration = null;
    activeAttempt = null;
    withdrawMarketingButton.hidden = true;
    withdrawSeparator.hidden = true;
    playerSignOutButton.hidden = true;
    sessionSeparator.hidden = true;
    playerName.textContent = "";
    showView("landing");
    showToast("Hráč byl odhlášen.");
  }

  document.getElementById("showLeaderboardButton").addEventListener("click", showLeaderboard);
  document.getElementById("headerLeaderboardButton").addEventListener("click", showLeaderboard);
  document.getElementById("gameLeaderboardButton").addEventListener("click", () => {
  window.PULS3Game?.pauseIfRunning();
  showLeaderboard();
});
  document.getElementById("refreshLeaderboardButton").addEventListener("click", loadLeaderboard);
  document.getElementById("backFromRegistrationButton").addEventListener("click", () => showView("landing"));
  document.getElementById("backToContestButton").addEventListener("click", () => {
    window.PULS3Game?.pauseIfRunning();
    showView("landing");
  });
  registrationForm.addEventListener("submit", submitRegistration);
  withdrawMarketingButton.addEventListener("click", withdrawMarketingConsent);
  playerSignOutButton.addEventListener("click", signOutPlayer);

  window.PULS3Contest = {
    canPlay: () => Boolean(registration),
    requestPlay: openContestEntry,
    beginAttempt,
    finishAttempt
  };

  loadLeaderboard();
  loadRegisteredCount();
  setupCaptcha();
  configureRegistrationAvailability();

  if (new URLSearchParams(window.location.search).get("view") === "registration") {
    showView("registration");
  }

  if (client) {
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      if (nextSession && !registration && !registrationSubmissionInProgress) {
        window.setTimeout(hydrateAuthenticatedUser, 0);
      } else if (!nextSession) {
        registration = null;
        activeAttempt = null;
        withdrawMarketingButton.hidden = true;
        withdrawSeparator.hidden = true;
        playerSignOutButton.hidden = true;
        sessionSeparator.hidden = true;
        playerName.textContent = "";
      }
    });
    hydrateAuthenticatedUser();
  }
})();
