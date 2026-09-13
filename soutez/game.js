(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const gameFrame = document.getElementById("gameFrame");
  const scoreValue = document.getElementById("scoreValue");
  const notesValue = document.getElementById("notesValue");
  const bestValue = document.getElementById("bestValue");
  const finalScore = document.getElementById("finalScore");
  const finalBest = document.getElementById("finalBest");
  const newRecordMessage = document.getElementById("newRecordMessage");
  const startOverlay = document.getElementById("startOverlay");
  const pauseOverlay = document.getElementById("pauseOverlay");
  const gameOverOverlay = document.getElementById("gameOverOverlay");
  const startButton = document.getElementById("startButton");
  const resumeButton = document.getElementById("resumeButton");
  const restartButton = document.getElementById("restartButton");
  const scoreSaveStatus = document.getElementById("scoreSaveStatus");
  const pauseButton = document.getElementById("pauseButton");
  const soundButton = document.getElementById("soundButton");
  const screenFlash = document.getElementById("screenFlash");
  const liveStatus = document.getElementById("liveStatus");

  let WIDTH = 1280;
  const HEIGHT = 720;
  const GROUND_Y = 590;
  const OVERDRIVE_SCORE = 10000;
  const BEST_KEY = "puls3-runner-best";
  const SOUND_KEY = "puls3-runner-sound";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    mode: "ready",
    lastTime: performance.now(),
    runTime: 0,
    distanceScore: 0,
    score: 0,
    notes: 0,
    best: readNumber(BEST_KEY),
    speed: 500,
    spawnTimer: 1.5,
    sceneTime: 0,
    shake: 0,
    flash: 0,
    obstacles: [],
    collectibles: [],
    particles: [],
    lastObstacleType: null,
    overdriveTime: 0,
    lowFlyingIntroduced: false,
    jumpCount: 0,
    attempt: null,
    saving: false,
    soundEnabled: safeStorageGet(SOUND_KEY) !== "off",
    autoPaused: false,
  };

  const player = {
    x: 205,
    y: GROUND_Y - 104,
    width: 62,
    height: 104,
    velocityY: 0,
    grounded: true,
    coyote: 0,
    squash: 0,
    stride: 0,
    landingSurfaceY: GROUND_Y,
  };

  const stars = Array.from({ length: 92 }, (_, index) => ({
    xRatio: pseudo(index * 7.1),
    y: 40 + pseudo(index * 13.7) * 340,
    size: 0.6 + pseudo(index * 19.3) * 1.7,
    phase: pseudo(index * 5.9) * Math.PI * 2,
  }));

  const crowd = Array.from({ length: 76 }, (_, index) => ({
    xRatio: index / 75,
    offsetX: (pseudo(index * 8.2) - 0.5) * 17,
    height: 20 + pseudo(index * 2.5) * 42,
    sway: pseudo(index * 11.4) * Math.PI * 2,
    layer: index % 3,
  }));

  let audioContext = null;
  let musicTimer = null;
  let beatIndex = 0;
  let masterGain = null;

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Hra zůstane funkční i při zakázaném úložišti prohlížeče.
    }
  }

  function readNumber(key) {
    const value = Number.parseInt(safeStorageGet(key) || "0", 10);
    return Number.isFinite(value) ? value : 0;
  }

  function pseudo(seed) {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function formatScore(value) {
    return Math.max(0, Math.floor(value)).toString().padStart(6, "0");
  }

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const bounds = canvas.getBoundingClientRect();
    const displayRatio = bounds.height > 0 ? bounds.width / bounds.height : 16 / 9;
    WIDTH = Math.max(480, Math.min(1680, Math.round(HEIGHT * displayRatio)));
    canvas.width = WIDTH * ratio;
    canvas.height = HEIGHT * ratio;
    canvas.dataset.ratio = String(ratio);
    player.x = Math.min(205, WIDTH * 0.17);
  }

  function setTransform() {
    const ratio = Number(canvas.dataset.ratio || 1);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function resetGame() {
    state.runTime = 0;
    state.distanceScore = 0;
    state.score = 0;
    state.notes = 0;
    state.speed = 500;
    state.spawnTimer = 1.05;
    state.shake = 0;
    state.obstacles.length = 0;
    state.collectibles.length = 0;
    state.particles.length = 0;
    state.lastObstacleType = null;
    state.overdriveTime = 0;
    state.lowFlyingIntroduced = false;
    state.jumpCount = 0;
    state.attempt = null;
    player.x = Math.min(205, WIDTH * 0.17);
    player.y = GROUND_Y - player.height;
    player.velocityY = 0;
    player.grounded = true;
    player.coyote = 0;
    player.squash = 0;
    player.landingSurfaceY = GROUND_Y;
    updateHud();
  }

  async function startGame() {
    if (state.mode === "starting" || state.saving) return;
    const previousMode = state.mode;
    const contest = window.PULS3Contest;
    if (contest && !contest.canPlay()) {
      contest.requestPlay();
      return;
    }

    state.mode = "starting";
    startButton.disabled = true;
    restartButton.disabled = true;
    scoreSaveStatus.textContent = "Připravuji soutěžní pokus…";

    const attempt = contest ? await contest.beginAttempt() : { practice: true };
    if (!attempt) {
      state.mode = previousMode;
      startButton.disabled = false;
      restartButton.disabled = false;
      scoreSaveStatus.textContent = "Pokus se nepodařilo zahájit.";
      return;
    }

    initAudio();
    resetGame();
    state.attempt = attempt;
    hideAllOverlays();
    state.mode = "running";
    state.lastTime = performance.now();
    pauseButton.classList.remove("is-paused");
    pauseButton.setAttribute("aria-label", "Pozastavit hru");
    startMusic();
    liveStatus.textContent = "Hra začala.";
    scoreSaveStatus.textContent = "";
    startButton.disabled = false;
    restartButton.disabled = false;
    canvas.focus({ preventScroll: true });
  }

  function endGame() {
    if (state.mode !== "running") return;
    state.mode = "over";
    stopMusic();
    playCrash();
    state.shake = reducedMotion ? 0 : 16;
    flashScreen();
    burst(player.x + player.width * 0.5, player.y + player.height * 0.55, "#ef6cff", 26, 420);

    const finishedScore = Math.floor(state.score);
    const isRecord = finishedScore > state.best;
    if (isRecord) {
      state.best = finishedScore;
      safeStorageSet(BEST_KEY, String(state.best));
    }
    updateHud();
    finalScore.textContent = finishedScore.toLocaleString("cs-CZ");
    finalBest.textContent = state.best.toLocaleString("cs-CZ");
    newRecordMessage.classList.toggle("is-visible", isRecord);
    gameOverOverlay.classList.add("is-visible");
    liveStatus.textContent = `Konec hry. Skóre ${finishedScore}.`;
    saveFinishedScore(finishedScore);
    window.setTimeout(() => restartButton.focus(), 180);
  }

  async function saveFinishedScore(finishedScore) {
    const contest = window.PULS3Contest;
    if (!contest || !state.attempt) {
      scoreSaveStatus.textContent = "Tréninkové skóre se do žebříčku neukládá.";
      return;
    }

    scoreSaveStatus.classList.remove("is-success", "is-error");
    scoreSaveStatus.textContent = "Ověřuji a ukládám skóre…";
    state.saving = true;
    restartButton.disabled = true;
    try {
      const result = await contest.finishAttempt({
        score: finishedScore,
        distanceScore: Math.floor(state.distanceScore),
        notes: state.notes,
        durationMs: Math.round(state.runTime * 1000),
        jumps: state.jumpCount
      });
      scoreSaveStatus.textContent = result.message;
      scoreSaveStatus.classList.add(result.accepted ? "is-success" : "is-error");
    } finally {
      state.saving = false;
      restartButton.disabled = false;
    }
  }

  function pauseGame(auto = false) {
    if (state.mode !== "running") return;
    state.mode = "paused";
    state.autoPaused = auto;
    stopMusic();
    pauseButton.classList.add("is-paused");
    pauseButton.setAttribute("aria-label", "Pokračovat ve hře");
    pauseOverlay.classList.add("is-visible");
    liveStatus.textContent = "Hra je pozastavena.";
  }

  function resumeGame() {
    if (state.mode !== "paused") return;
    initAudio();
    state.mode = "running";
    state.autoPaused = false;
    state.lastTime = performance.now();
    pauseButton.classList.remove("is-paused");
    pauseButton.setAttribute("aria-label", "Pozastavit hru");
    pauseOverlay.classList.remove("is-visible");
    startMusic();
    liveStatus.textContent = "Hra pokračuje.";
    canvas.focus({ preventScroll: true });
  }

  function togglePause() {
    if (state.mode === "running") pauseGame(false);
    else if (state.mode === "paused") resumeGame();
  }

  function hideAllOverlays() {
    startOverlay.classList.remove("is-visible");
    pauseOverlay.classList.remove("is-visible");
    gameOverOverlay.classList.remove("is-visible");
  }

  function jump() {
    if (state.mode === "ready" || state.mode === "over") {
      startGame();
      return;
    }
    if (state.mode === "paused") {
      resumeGame();
      return;
    }
    if (state.mode !== "running") return;
    if (player.grounded || player.coyote > 0) {
      state.jumpCount += 1;
      player.velocityY = -940;
      player.grounded = false;
      player.coyote = 0;
      player.squash = -0.16;
      playJump();
      burst(player.x + 25, GROUND_Y - 5, "#9f55ff", 9, 150);
    }
  }

  function update(delta) {
    state.sceneTime += delta;
    updateParticles(delta);
    if (state.mode !== "running") return;

    state.runTime += delta;
    state.distanceScore += state.speed * delta * 0.076;
    state.score = state.distanceScore + state.notes * 250;

    const baseSpeed = Math.min(820, 500 + state.runTime * 5.5);
    if (state.score >= OVERDRIVE_SCORE) {
      state.overdriveTime += delta;
      const playableLimit = WIDTH < 650 ? 1050 : WIDTH < 950 ? 1120 : 1200;
      state.speed = Math.min(playableLimit, Math.max(baseSpeed, 820 + state.overdriveTime * 52));
    } else {
      state.speed = baseSpeed;
    }

    player.stride += delta * (state.speed / 42);
    player.squash += (0 - player.squash) * Math.min(1, delta * 11);

    state.spawnTimer -= delta;
    if (state.spawnTimer <= 0) spawnObstacle();

    for (const obstacle of state.obstacles) {
      obstacle.x -= state.speed * delta;
      if (obstacle.type === "flyingLight") {
        obstacle.y = obstacle.baseY + Math.sin(state.sceneTime * 3.2 + obstacle.phase) * 10;
      }
    }
    for (const collectible of state.collectibles) {
      collectible.x -= state.speed * delta;
      collectible.spin += delta * 5.5;
      collectible.float += delta * 3.5;
    }

    const wasGrounded = player.grounded;
    const previousBottom = player.y + player.height;
    player.velocityY += 2450 * delta;
    player.y += player.velocityY * delta;
    resolveLanding(previousBottom, wasGrounded, delta);

    state.obstacles = state.obstacles.filter((item) => item.x + item.width > -80);
    state.collectibles = state.collectibles.filter((item) => !item.collected && item.x > -60);

    checkCollisions();
    updateHud();
    state.shake = Math.max(0, state.shake - delta * 36);
  }

  function spawnObstacle() {
    const difficulty = Math.min(1, state.runTime / 70);
    const isOverdrive = state.score >= OVERDRIVE_SCORE;
    const roll = Math.random();
    let type;
    const canSpawnFlying = state.runTime >= 9 && state.lastObstacleType !== "flyingLight";
    const forceFirstLowFlying = isOverdrive && canSpawnFlying && !state.lowFlyingIntroduced;
    const flyingChance = canSpawnFlying ? (isOverdrive ? 0.36 : 0.17 + difficulty * 0.15) : 0;
    if (forceFirstLowFlying || (canSpawnFlying && Math.random() < flyingChance)) type = "flyingLight";
    else if (roll < 0.34) type = "case";
    else if (roll < 0.67) type = "speaker";
    else type = "amp";

    const specs = {
      case: { width: 94, height: 73 },
      speaker: { width: 80, height: 122 },
      amp: { width: 112, height: 86 },
      flyingLight: { width: 104, height: 62 },
    }[type];

    const isFlying = type === "flyingLight";
    const flightLevel = isFlying
      ? isOverdrive && (forceFirstLowFlying || Math.random() < 0.58)
        ? "low"
        : "high"
      : null;
    const obstacleY = isFlying
      ? flightLevel === "low"
        ? GROUND_Y - specs.height - 18
        : GROUND_Y - 200
      : GROUND_Y - specs.height;

    const obstacle = {
      type,
      x: WIDTH + 70,
      y: obstacleY,
      baseY: obstacleY,
      width: specs.width,
      height: specs.height,
      phase: Math.random() * Math.PI * 2,
      canLand: !isFlying,
      flightLevel,
    };
    state.obstacles.push(obstacle);
    state.lastObstacleType = type;
    if (flightLevel === "low") state.lowFlyingIntroduced = true;

    const noteChance = 0.7;
    if (Math.random() < noteChance) {
      const arcHeight = isFlying
        ? flightLevel === "low"
          ? random(145, 170)
          : random(48, 64)
        : type === "speaker"
          ? 188
          : random(132, 176);
      state.collectibles.push({
        x: obstacle.x + obstacle.width * 0.45,
        y: GROUND_Y - arcHeight,
        radius: 20,
        spin: Math.random() * Math.PI * 2,
        float: Math.random() * Math.PI * 2,
        collected: false,
      });
    } else if (Math.random() < 0.35 + difficulty * 0.15) {
      state.collectibles.push({
        x: obstacle.x + obstacle.width + 96,
        y: GROUND_Y - random(105, 155),
        radius: 20,
        spin: 0,
        float: 0,
        collected: false,
      });
    }

    const baseGap = isFlying ? random(1.2, 1.48) : random(1.08, 1.48);
    const overdrivePressure = isOverdrive ? Math.min(0.24, state.overdriveTime * 0.024) : 0;
    state.spawnTimer = Math.max(isOverdrive ? 0.8 : 0.96, baseGap - difficulty * 0.06 - overdrivePressure);
  }

  function resolveLanding(previousBottom, wasGrounded, delta) {
    const playerLeft = player.x + 10;
    const playerRight = player.x + player.width - 10;
    const currentBottom = player.y + player.height;
    let landingObstacle = null;

    if (player.velocityY >= 0) {
      for (const obstacle of state.obstacles) {
        if (!obstacle.canLand) continue;
        const overlapsHorizontally =
          playerRight > obstacle.x + 5 && playerLeft < obstacle.x + obstacle.width - 5;
        const crossedTop = previousBottom <= obstacle.y + 12 && currentBottom >= obstacle.y;
        if (overlapsHorizontally && crossedTop) {
          if (!landingObstacle || obstacle.y < landingObstacle.y) landingObstacle = obstacle;
        }
      }
    }

    let surfaceY = GROUND_Y;
    if (landingObstacle) {
      surfaceY = landingObstacle.y;
      player.y = surfaceY - player.height;
      player.velocityY = 0;
      player.grounded = true;
    } else if (currentBottom >= GROUND_Y) {
      player.y = GROUND_Y - player.height;
      player.velocityY = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }

    player.landingSurfaceY = surfaceY;
    if (player.grounded) {
      player.coyote = 0.085;
      if (!wasGrounded) {
        player.squash = 0.18;
        burst(player.x + player.width * 0.45, surfaceY - 2, "#d0a6ff", 6, 95);
      }
    } else {
      player.coyote = Math.max(0, player.coyote - delta);
    }
  }

  function checkCollisions() {
    const px = player.x + 13;
    const py = player.y + 11;
    const pw = player.width - 25;
    const ph = player.height - 15;

    for (const obstacle of state.obstacles) {
      const insetX = obstacle.type === "speaker" ? 8 : obstacle.type === "flyingLight" ? 12 : 6;
      const insetY = obstacle.type === "case" ? 9 : obstacle.type === "flyingLight" ? 8 : 5;
      if (
        px < obstacle.x + obstacle.width - insetX &&
        px + pw > obstacle.x + insetX &&
        py < obstacle.y + obstacle.height &&
        py + ph > obstacle.y + insetY
      ) {
        endGame();
        return;
      }
    }

    const centerX = player.x + player.width * 0.5;
    const centerY = player.y + player.height * 0.46;
    for (const note of state.collectibles) {
      const dx = centerX - note.x;
      const dy = centerY - (note.y + Math.sin(note.float) * 6);
      const reach = note.radius + 27;
      if (dx * dx + dy * dy < reach * reach) {
        note.collected = true;
        state.notes += 1;
        state.score = state.distanceScore + state.notes * 250;
        playCollect();
        burst(note.x, note.y, "#54ecff", 14, 230);
        state.flash = 0.12;
      }
    }
  }

  function burst(x, y, color, count, force) {
    if (reducedMotion) count = Math.min(4, count);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = random(force * 0.35, force);
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: random(0.28, 0.68),
        maxLife: 0.68,
        size: random(2, 6),
        color,
      });
    }
  }

  function updateParticles(delta) {
    for (const particle of state.particles) {
      particle.life -= delta;
      particle.vy += 340 * delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
    }
    state.particles = state.particles.filter((particle) => particle.life > 0);
  }

  function updateHud() {
    scoreValue.textContent = formatScore(state.score);
    notesValue.textContent = String(state.notes);
    bestValue.textContent = formatScore(state.best);
  }

  function render() {
    setTransform();
    ctx.save();
    if (state.shake > 0) {
      ctx.translate(random(-state.shake, state.shake), random(-state.shake * 0.45, state.shake * 0.45));
    }
    drawBackground();
    drawStage();
    drawCollectibles();
    drawObstacles();
    drawPlayer();
    drawParticles();
    drawVignette();
    ctx.restore();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, "#08030d");
    sky.addColorStop(0.55, "#170923");
    sky.addColorStop(1, "#07040b");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const horizonGlow = ctx.createRadialGradient(WIDTH * 0.52, 390, 30, WIDTH * 0.52, 390, 580);
    horizonGlow.addColorStop(0, "rgba(179, 52, 255, 0.24)");
    horizonGlow.addColorStop(0.5, "rgba(83, 24, 129, 0.10)");
    horizonGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    for (const star of stars) {
      const twinkle = 0.32 + Math.sin(state.sceneTime * 1.9 + star.phase) * 0.2;
      ctx.fillStyle = `rgba(211, 178, 255, ${twinkle})`;
      ctx.beginPath();
      ctx.arc(star.xRatio * WIDTH, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }

    drawTruss();
    drawSpotlight(150, -20, 440, 560, "rgba(104, 58, 255, 0.13)", 0.8);
    drawSpotlight(1130, -20, 820, 560, "rgba(240, 52, 255, 0.11)", 1.15);
    drawSpotlight(510, -15, 680, 560, "rgba(56, 210, 255, 0.065)", 1.7);
    drawCrowd();
  }

  function drawTruss() {
    ctx.save();
    ctx.strokeStyle = "rgba(186, 157, 208, 0.28)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 122);
    ctx.lineTo(WIDTH, 122);
    ctx.moveTo(0, 158);
    ctx.lineTo(WIDTH, 158);
    ctx.stroke();

    ctx.lineWidth = 2;
    for (let x = -20; x < WIDTH + 60; x += 74) {
      ctx.beginPath();
      ctx.moveTo(x, 122);
      ctx.lineTo(x + 74, 158);
      ctx.moveTo(x + 74, 122);
      ctx.lineTo(x, 158);
      ctx.stroke();
    }

    for (let x = 86; x < WIDTH; x += 215) {
      ctx.fillStyle = "#1c1523";
      ctx.fillRect(x - 19, 151, 38, 23);
      const glow = ctx.createRadialGradient(x, 174, 1, x, 174, 28);
      glow.addColorStop(0, "rgba(222, 94, 255, 0.85)");
      glow.addColorStop(1, "rgba(222, 94, 255, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - 30, 148, 60, 58);
    }
    ctx.restore();
  }

  function drawSpotlight(originX, originY, targetX, targetY, color, phase) {
    const drift = Math.sin(state.sceneTime * 0.52 + phase) * 145;
    const gradient = ctx.createLinearGradient(originX, originY, targetX + drift, targetY);
    gradient.addColorStop(0, color.replace(/0\.\d+\)/, "0.02)"));
    gradient.addColorStop(1, color);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(originX - 17, originY);
    ctx.lineTo(originX + 17, originY);
    ctx.lineTo(targetX + drift + 170, targetY);
    ctx.lineTo(targetX + drift - 170, targetY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCrowd() {
    for (let layer = 0; layer < 3; layer += 1) {
      ctx.save();
      const yBase = 505 + layer * 15;
      ctx.fillStyle = layer === 0 ? "#120c18" : layer === 1 ? "#0d0912" : "#08060b";
      for (const person of crowd) {
        if (person.layer !== layer) continue;
        const personX = person.xRatio * WIDTH + person.offsetX;
        const sway = Math.sin(state.sceneTime * 1.5 + person.sway) * (3 + layer);
        const headY = yBase - person.height;
        ctx.beginPath();
        ctx.arc(personX + sway, headY, 8 + layer * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(personX - 10 + sway, headY + 6, 21, person.height + 34);
        if ((Math.floor(person.sway * 10) + layer) % 4 === 0) {
          ctx.save();
          ctx.translate(personX + sway, headY + 20);
          ctx.rotate(Math.sin(state.sceneTime * 2 + person.sway) * 0.12);
          ctx.fillRect(-4, -36, 8, 44);
          ctx.restore();
        }
      }
      ctx.restore();
    }
  }

  function drawStage() {
    ctx.fillStyle = "#0b0810";
    ctx.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);

    const edgeGlow = ctx.createLinearGradient(0, GROUND_Y - 6, 0, GROUND_Y + 24);
    edgeGlow.addColorStop(0, "rgba(223, 89, 255, 0.85)");
    edgeGlow.addColorStop(0.18, "rgba(125, 43, 180, 0.25)");
    edgeGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = edgeGlow;
    ctx.fillRect(0, GROUND_Y - 6, WIDTH, 32);

    ctx.strokeStyle = "rgba(186, 111, 226, 0.11)";
    ctx.lineWidth = 2;
    const floorOffset = -((state.sceneTime * state.speed * 0.28) % 110);
    for (let x = floorOffset; x < WIDTH + 110; x += 110) {
      ctx.beginPath();
      ctx.moveTo(WIDTH * 0.5 + (x - WIDTH * 0.5) * 0.3, GROUND_Y);
      ctx.lineTo(x, HEIGHT);
      ctx.stroke();
    }
    for (let y = GROUND_Y + 35; y < HEIGHT; y += 38) {
      ctx.globalAlpha = 1 - (y - GROUND_Y) / 260;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WIDTH, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    const airTilt = Math.max(-0.18, Math.min(0.14, player.velocityY / 2500));
    const run = player.grounded ? Math.sin(player.stride) : 0.22;
    const squashX = 1 + player.squash;
    const squashY = 1 - player.squash;
    const centerX = player.x + player.width * 0.5;
    const centerY = player.y + player.height * 0.5;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(airTilt);
    ctx.scale(squashX, squashY);
    ctx.translate(-centerX, -centerY);

    ctx.save();
    ctx.shadowColor = "rgba(205, 73, 255, 0.85)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "rgba(185, 57, 255, 0.26)";
    ctx.beginPath();
    ctx.ellipse(centerX, player.y + 60, 39, 55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "#17101e";
    ctx.lineWidth = 11;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(player.x + 27, player.y + 68);
    ctx.lineTo(player.x + 20 - run * 8, player.y + 99);
    ctx.moveTo(player.x + 42, player.y + 69);
    ctx.lineTo(player.x + 49 + run * 8, player.y + 99);
    ctx.stroke();

    const jacket = ctx.createLinearGradient(player.x + 16, player.y + 30, player.x + 56, player.y + 76);
    jacket.addColorStop(0, "#d86aff");
    jacket.addColorStop(0.48, "#8b2de2");
    jacket.addColorStop(1, "#42106e");
    ctx.fillStyle = jacket;
    ctx.beginPath();
    ctx.moveTo(player.x + 21, player.y + 31);
    ctx.quadraticCurveTo(player.x + 35, player.y + 24, player.x + 50, player.y + 36);
    ctx.lineTo(player.x + 47, player.y + 76);
    ctx.lineTo(player.x + 19, player.y + 73);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.62)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x + 35, player.y + 34);
    ctx.lineTo(player.x + 33, player.y + 70);
    ctx.stroke();

    ctx.strokeStyle = "#24122f";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(player.x + 25, player.y + 35);
    ctx.lineTo(player.x + 48, player.y + 70);
    ctx.stroke();
    ctx.strokeStyle = "rgba(78, 232, 255, 0.72)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = "#c486e8";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(player.x + 23, player.y + 42);
    ctx.lineTo(player.x + 37 - run, player.y + 60);
    ctx.moveTo(player.x + 49, player.y + 43);
    ctx.lineTo(player.x + 61 + run, player.y + 52);
    ctx.stroke();

    ctx.fillStyle = "#191020";
    ctx.beginPath();
    ctx.arc(player.x + 36, player.y + 18, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#bb75da";
    ctx.beginPath();
    ctx.arc(player.x + 38, player.y + 19, 12.5, -0.25, Math.PI * 1.65);
    ctx.fill();
    ctx.fillStyle = "#0e0913";
    ctx.beginPath();
    ctx.moveTo(player.x + 21, player.y + 11);
    ctx.quadraticCurveTo(player.x + 34, player.y - 7, player.x + 55, player.y + 9);
    ctx.lineTo(player.x + 45, player.y + 14);
    ctx.lineTo(player.x + 30, player.y + 6);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(player.x + 43, player.y + 63);
    ctx.rotate(-0.54 + run * 0.018);
    ctx.shadowColor = "rgba(222, 70, 255, 0.78)";
    ctx.shadowBlur = 16;

    ctx.strokeStyle = "#2a1236";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(2, -2);
    ctx.lineTo(42, -2);
    ctx.stroke();
    ctx.strokeStyle = "#b76ee0";
    ctx.lineWidth = 5;
    ctx.stroke();

    const guitarBody = ctx.createLinearGradient(-18, -16, 13, 18);
    guitarBody.addColorStop(0, "#ff67e7");
    guitarBody.addColorStop(0.48, "#a836ef");
    guitarBody.addColorStop(1, "#501087");
    ctx.fillStyle = guitarBody;
    ctx.beginPath();
    ctx.moveTo(-11, -17);
    ctx.bezierCurveTo(-23, -14, -24, -4, -14, 1);
    ctx.bezierCurveTo(-22, 8, -16, 20, -4, 18);
    ctx.bezierCurveTo(5, 17, 7, 10, 6, 4);
    ctx.bezierCurveTo(17, 2, 17, -11, 7, -14);
    ctx.bezierCurveTo(1, -16, -1, -11, -4, -8);
    ctx.bezierCurveTo(-6, -11, -8, -15, -11, -17);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 218, 255, 0.78)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "rgba(22, 7, 31, 0.72)";
    ctx.beginPath();
    ctx.ellipse(-3, 2, 8, 11, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#77f2ff";
    ctx.fillRect(-2, -7, 3, 19);
    ctx.fillRect(4, -6, 3, 16);

    ctx.strokeStyle = "#e6c5f5";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-8, -2);
    ctx.lineTo(46, -2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-8, 1);
    ctx.lineTo(46, 1);
    ctx.stroke();

    ctx.fillStyle = "#d85aff";
    ctx.beginPath();
    ctx.moveTo(39, -8);
    ctx.lineTo(50, -6);
    ctx.lineTo(48, 5);
    ctx.lineTo(39, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#8df6ff";
    for (const [pegX, pegY] of [[43, -8], [48, -8], [43, 5], [48, 5]]) {
      ctx.beginPath();
      ctx.arc(pegX, pegY, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#c98ae5";
    ctx.beginPath();
    ctx.arc(18, -2, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-2, Math.sin(player.stride * 2) * 2, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#08060b";
    ctx.fillRect(player.x + 8 - run * 8, player.y + 95, 22, 8);
    ctx.fillRect(player.x + 40 + run * 8, player.y + 95, 22, 8);
    ctx.restore();

    if (player.grounded) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.36)";
      ctx.beginPath();
      ctx.ellipse(centerX, player.landingSurfaceY + 8, 42 - Math.abs(run) * 4, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawObstacles() {
    for (const obstacle of state.obstacles) {
      if (obstacle.type === "speaker") drawSpeaker(obstacle);
      else if (obstacle.type === "amp") drawAmp(obstacle);
      else if (obstacle.type === "flyingLight") drawFlyingLight(obstacle);
      else drawCase(obstacle);
    }
  }

  function roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawCase(item) {
    ctx.save();
    ctx.shadowColor = "rgba(203, 64, 255, 0.38)";
    ctx.shadowBlur = 17;
    const gradient = ctx.createLinearGradient(item.x, item.y, item.x + item.width, item.y + item.height);
    gradient.addColorStop(0, "#31213c");
    gradient.addColorStop(1, "#100b15");
    ctx.fillStyle = gradient;
    roundedRect(item.x, item.y, item.width, item.height, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#a98bb6";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = "rgba(219, 190, 231, 0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(item.x + 5, item.y + 16);
    ctx.lineTo(item.x + item.width - 5, item.y + 16);
    ctx.moveTo(item.x + 16, item.y + 4);
    ctx.lineTo(item.x + 16, item.y + item.height - 4);
    ctx.moveTo(item.x + item.width - 16, item.y + 4);
    ctx.lineTo(item.x + item.width - 16, item.y + item.height - 4);
    ctx.stroke();
    ctx.fillStyle = "#d052ff";
    ctx.font = "900 17px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("PULS3", item.x + item.width * 0.5, item.y + 51);
    ctx.restore();
  }

  function drawSpeaker(item) {
    ctx.save();
    ctx.shadowColor = "rgba(126, 49, 255, 0.4)";
    ctx.shadowBlur = 18;
    const gradient = ctx.createLinearGradient(item.x, item.y, item.x + item.width, item.y);
    gradient.addColorStop(0, "#261531");
    gradient.addColorStop(0.5, "#0d0a10");
    gradient.addColorStop(1, "#23112d");
    ctx.fillStyle = gradient;
    roundedRect(item.x, item.y, item.width, item.height, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#6c4a7c";
    ctx.lineWidth = 3;
    ctx.stroke();
    drawSpeakerCone(item.x + item.width * 0.5, item.y + 37, 22);
    drawSpeakerCone(item.x + item.width * 0.5, item.y + 89, 27);
    ctx.fillStyle = "#cf4fff";
    ctx.fillRect(item.x + 13, item.y + 7, item.width - 26, 3);
    ctx.restore();
  }

  function drawSpeakerCone(x, y, radius) {
    const cone = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.25, 2, x, y, radius);
    cone.addColorStop(0, "#9b5cae");
    cone.addColorStop(0.22, "#3a2941");
    cone.addColorStop(0.72, "#121015");
    cone.addColorStop(1, "#030304");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(214, 140, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawAmp(item) {
    ctx.save();
    ctx.shadowColor = "rgba(224, 65, 255, 0.38)";
    ctx.shadowBlur = 17;
    ctx.fillStyle = "#171019";
    roundedRect(item.x, item.y, item.width, item.height, 9);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#8f54a4";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "#2a1c2e";
    roundedRect(item.x + 9, item.y + 21, item.width - 18, item.height - 31, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(214, 187, 225, 0.26)";
    ctx.lineWidth = 1;
    for (let x = item.x + 13; x < item.x + item.width - 10; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, item.y + 24);
      ctx.lineTo(x - 15, item.y + item.height - 12);
      ctx.stroke();
    }
    ctx.fillStyle = "#d45eff";
    ctx.fillRect(item.x + 10, item.y + 9, item.width - 20, 5);
    for (let index = 0; index < 4; index += 1) {
      ctx.fillStyle = index === 0 ? "#54edff" : "#c196d1";
      ctx.beginPath();
      ctx.arc(item.x + 24 + index * 17, item.y + 12, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFlyingLight(item) {
    const centerX = item.x + item.width * 0.5;
    const centerY = item.y + item.height * 0.5;
    ctx.save();

    const beam = ctx.createLinearGradient(centerX, item.y + item.height, centerX, GROUND_Y);
    beam.addColorStop(0, "rgba(78, 232, 255, 0.15)");
    beam.addColorStop(1, "rgba(78, 232, 255, 0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(centerX - 17, item.y + item.height - 2);
    ctx.lineTo(centerX + 17, item.y + item.height - 2);
    ctx.lineTo(centerX + 63, GROUND_Y);
    ctx.lineTo(centerX - 63, GROUND_Y);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = "rgba(75, 231, 255, 0.72)";
    ctx.shadowBlur = 22;
    const body = ctx.createLinearGradient(item.x, item.y, item.x + item.width, item.y + item.height);
    body.addColorStop(0, "#302040");
    body.addColorStop(0.52, "#100b16");
    body.addColorStop(1, "#271033");
    ctx.fillStyle = body;
    roundedRect(item.x + 12, item.y + 12, item.width - 24, item.height - 17, 13);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#a95dc7";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.strokeStyle = "#81618f";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(item.x + 16, centerY);
    ctx.lineTo(item.x + 3, item.y + 8);
    ctx.moveTo(item.x + item.width - 16, centerY);
    ctx.lineTo(item.x + item.width - 3, item.y + 8);
    ctx.stroke();

    for (const rotorX of [item.x + 4, item.x + item.width - 4]) {
      ctx.save();
      ctx.translate(rotorX, item.y + 8);
      ctx.rotate(state.sceneTime * 13 + item.phase);
      ctx.strokeStyle = "rgba(180, 235, 255, 0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-19, 0);
      ctx.lineTo(19, 0);
      ctx.moveTo(0, -7);
      ctx.lineTo(0, 7);
      ctx.stroke();
      ctx.restore();
    }

    const lens = ctx.createRadialGradient(centerX - 4, centerY + 8, 2, centerX, centerY + 8, 15);
    lens.addColorStop(0, "#e9fdff");
    lens.addColorStop(0.3, "#4be7ff");
    lens.addColorStop(1, "#17262b");
    ctx.fillStyle = lens;
    ctx.beginPath();
    ctx.arc(centerX, centerY + 8, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f15cff";
    ctx.beginPath();
    ctx.arc(centerX - 25, centerY - 8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCollectibles() {
    for (const note of state.collectibles) {
      if (note.collected) continue;
      const y = note.y + Math.sin(note.float) * 6;
      const pulse = 1 + Math.sin(note.spin * 1.7) * 0.08;
      ctx.save();
      ctx.translate(note.x, y);
      ctx.scale(pulse, pulse);
      ctx.rotate(Math.sin(note.spin) * 0.12);
      ctx.shadowColor = "#4be7ff";
      ctx.shadowBlur = 24;
      const glow = ctx.createRadialGradient(0, 0, 3, 0, 0, 28);
      glow.addColorStop(0, "rgba(171, 251, 255, 0.55)");
      glow.addColorStop(1, "rgba(75, 231, 255, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 29, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8df5ff";
      ctx.font = "900 42px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("♪", 0, 1);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const particle of state.particles) {
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function drawVignette() {
    const vignette = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.47, 210, WIDTH * 0.5, HEIGHT * 0.5, 790);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.75, "rgba(0,0,0,0.08)");
    vignette.addColorStop(1, "rgba(0,0,0,0.56)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function flashScreen() {
    screenFlash.classList.remove("is-flashing");
    void screenFlash.offsetWidth;
    screenFlash.classList.add("is-flashing");
  }

  function initAudio() {
    if (!state.soundEnabled) return;
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      audioContext = new AudioCtor();
      masterGain = audioContext.createGain();
      masterGain.gain.value = 0.38;
      masterGain.connect(audioContext.destination);
    }
    if (audioContext.state === "suspended") audioContext.resume();
  }

  function tone(frequency, duration, options = {}) {
    if (!state.soundEnabled || !audioContext || !masterGain) return;
    const now = audioContext.currentTime + (options.delay || 0);
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = options.type || "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    if (options.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(options.volume || 0.12, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  function noise(duration, volume) {
    if (!state.soundEnabled || !audioContext || !masterGain) return;
    const length = Math.floor(audioContext.sampleRate * duration);
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1800;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start();
  }

  function playJump() {
    initAudio();
    tone(220, 0.15, { type: "square", endFrequency: 510, volume: 0.085 });
  }

  function playCollect() {
    tone(740, 0.13, { type: "sine", endFrequency: 1180, volume: 0.11 });
    tone(1110, 0.16, { type: "triangle", delay: 0.06, volume: 0.075 });
  }

  function playCrash() {
    tone(150, 0.42, { type: "sawtooth", endFrequency: 52, volume: 0.14 });
    noise(0.22, 0.095);
  }

  function playBeat() {
    if (state.mode !== "running" || !state.soundEnabled) return;
    const bass = [55, 55, 65.41, 49][Math.floor(beatIndex / 2) % 4];
    if (beatIndex % 2 === 0) tone(bass, 0.2, { type: "sawtooth", endFrequency: bass * 0.96, volume: 0.035 });
    if (beatIndex % 4 === 0) tone(72, 0.12, { type: "sine", endFrequency: 42, volume: 0.13 });
    if (beatIndex % 2 === 1) noise(0.035, 0.025);
    beatIndex = (beatIndex + 1) % 16;
  }

  function startMusic() {
    if (!state.soundEnabled) return;
    initAudio();
    stopMusic();
    beatIndex = 0;
    playBeat();
    musicTimer = window.setInterval(playBeat, 235);
  }

  function stopMusic() {
    if (musicTimer !== null) {
      window.clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    safeStorageSet(SOUND_KEY, state.soundEnabled ? "on" : "off");
    soundButton.classList.toggle("is-muted", !state.soundEnabled);
    soundButton.setAttribute("aria-label", state.soundEnabled ? "Vypnout zvuk" : "Zapnout zvuk");
    if (state.soundEnabled) {
      initAudio();
      if (state.mode === "running") startMusic();
      playCollect();
    } else {
      stopMusic();
    }
  }

  function handleKeydown(event) {
    const target = event.target;
    const isTyping = target instanceof HTMLElement &&
      (target.matches("input, select, textarea, button, a") || target.isContentEditable);
    const gameSection = gameFrame.closest("[data-view]");
    if (isTyping || gameSection?.hidden) return;

    if (["Space", "ArrowUp"].includes(event.code)) {
      event.preventDefault();
      if (!event.repeat) jump();
      return;
    }
    if (event.code === "KeyP" && !event.repeat) togglePause();
    if (event.code === "KeyM" && !event.repeat) toggleSound();
  }

  function handleCanvasPointer(event) {
    event.preventDefault();
    jump();
  }

  function frame(time) {
    const delta = Math.min(0.033, Math.max(0, (time - state.lastTime) / 1000));
    state.lastTime = time;
    update(delta);
    render();
    requestAnimationFrame(frame);
  }

  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", startGame);
  resumeButton.addEventListener("click", resumeGame);
  pauseButton.addEventListener("click", togglePause);
  soundButton.addEventListener("click", toggleSound);
  canvas.addEventListener("pointerdown", handleCanvasPointer, { passive: false });
  window.addEventListener("keydown", handleKeydown, { passive: false });
  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.mode === "running") pauseGame(true);
  });
  window.addEventListener("blur", () => {
    if (state.mode === "running") pauseGame(true);
  });
  gameFrame.addEventListener("contextmenu", (event) => event.preventDefault());

  window.PULS3Game = {
    pauseIfRunning() {
      if (state.mode === "running") pauseGame(true);
    }
  };

  soundButton.classList.toggle("is-muted", !state.soundEnabled);
  soundButton.setAttribute("aria-label", state.soundEnabled ? "Vypnout zvuk" : "Zapnout zvuk");
  resizeCanvas();
  updateHud();
  requestAnimationFrame(frame);
})();
