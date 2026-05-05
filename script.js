(function () {
  "use strict";

  /**
   * @typedef {'idle'|'casting'|'noCatch'|'smallCatch'|'bite'|'reeling'|'cashedOut'|'snapped'} GameState
   * @typedef {{ id: string, name: string, chance: number, startMultiplier: number, color: string }} FishType
   */

  /** Панель «Рыбы» и pickFish(): доли внутри исхода fish (50+30+12+6+2 = 100%). */
  const fishTypes = [
    { id: "crucian", name: "Карась", chance: 50, startMultiplier: 1.2, color: "green" },
    { id: "perch", name: "Окунь", chance: 30, startMultiplier: 2, color: "blue" },
    { id: "pike", name: "Щука", chance: 12, startMultiplier: 3.5, color: "purple" },
    { id: "catfish", name: "Сом", chance: 6, startMultiplier: 6, color: "orange" },
    { id: "goldfish", name: "Золотая рыба", chance: 2, startMultiplier: 10, color: "gold" },
  ];

  const BET_MIN = 100;
  const BET_MAX = 5000;
  const BET_STEP = 100;
  const START_BALANCE = 10000;
  const HISTORY_CAP = 8;
  /** Пауза перед возвратом в idle после краша / ручного садка */
  const ROUND_END_MS = 1500;
  /** Пустой заброс и мелкий клёв: ровно 1.2 с перед idle */
  const MINOR_ROUND_MS = 1200;
  /** Максимальный множитель обрыва в прототипе */
  const CRASH_MULT_CAP = 20;

  const els = {
    balanceDisplay: document.getElementById("balanceDisplay"),
    betDisplayTop: document.getElementById("betDisplayTop"),
    betDisplay: document.getElementById("betDisplay"),
    statusText: document.getElementById("statusText"),
    multDisplay: document.getElementById("multDisplay"),
    catchDisplay: document.getElementById("catchDisplay"),
    fishLine: document.getElementById("fishLine"),
    tensionFill: document.getElementById("tensionFill"),
    resistanceHint: document.getElementById("resistanceHint"),
    historyList: document.getElementById("historyList"),
    historyPanel: document.getElementById("historyPanel"),
    histToggle: document.getElementById("histToggle"),
    btnCast: document.getElementById("btnCast"),
    btnCash: document.getElementById("btnCash"),
    betMinus: document.getElementById("betMinus"),
    betPlus: document.getElementById("betPlus"),
    waterZone: document.getElementById("waterZone"),
    fishSilhouette: document.getElementById("fishSilhouette"),
    lineWrap: document.getElementById("lineWrap"),
    linePath: document.getElementById("linePath"),
    rodRig: document.getElementById("rodRig"),
    flashGold: document.getElementById("flashGold"),
    flashRed: document.getElementById("flashRed"),
    flashSoftCyan: document.getElementById("flashSoftCyan"),
    flashBite: document.getElementById("flashBite"),
    biteCallout: document.getElementById("biteCallout"),
    autoCashoutToggle: document.getElementById("autoCashoutToggle"),
    autoCashoutState: document.getElementById("autoCashoutState"),
    autoCashoutMult: document.getElementById("autoCashoutMult"),
    autoPresets: document.getElementById("autoPresets"),
  };

  let balance = START_BALANCE;
  let bet = 500;
  /** Автокэшаут: при достижении множителя вызывается cashOut */
  let autoCashoutEnabled = false;
  let autoCashoutValue = 2;
  /** @type {GameState} */
  let phase = "idle";
  /** @type {FishType|null} */
  let currentFish = null;
  /** Текущий множитель (плавный рост во время reeling) */
  let currentMultiplier = 1;
  /** Скрытая точка обрыва (множитель) */
  let crashPoint = Infinity;
  let betLocked = 0;
  let rafId = 0;
  let lastTs = 0;
  /** Время старта фазы reeling (для ускорения роста) */
  let reelStartTs = 0;
  /** Одноразовый вибро-импульс при «всплеске» атмосферного сопротивления (не связано с обрывом). */
  let resistanceSpikeVibratePrimed = true;
  /** Wall-clock старт фазы reeling — только для атмосферного индикатора. */
  let reelWallStartMs = 0;
  /** Случайная фаза колебаний индикатора «сопротивление» за раунд. */
  let resistanceVisualSeed = 0;

  const EVENT_BODY_CLASSES = [
    "event-no-catch",
    "event-small-catch",
    "event-bite",
    "event-reeling",
    "event-intense",
    "event-win",
    "event-snap",
  ];

  /**
   * Безопасный вызов Vibration API (мобильные).
   * @param {number|number[]} pattern
   */
  function triggerVibration(pattern) {
    try {
      var nav = navigator;
      if (!nav || typeof nav.vibrate !== "function") return;
      nav.vibrate(pattern);
    } catch (e) {}
  }

  /** Короткие щелчки катушки (имитация смотки лески при пустом забросе). */
  function playReelWindTicks() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var start = function () {
        var n = 12;
        var t = ctx.currentTime + 0.02;
        for (var i = 0; i < n; i++) {
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "square";
          osc.frequency.setValueAtTime(160 + Math.random() * 90, t);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.018, t + 0.004);
          g.gain.linearRampToValueAtTime(0, t + 0.028);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.032);
          t += 0.042 + Math.random() * 0.035;
        }
        window.setTimeout(function () {
          try {
            ctx.close();
          } catch (e2) {}
        }, Math.max(0, (t - ctx.currentTime) * 1000) + 80);
      };
      if (ctx.state === "suspended") {
        ctx.resume().then(start);
      } else {
        start();
      }
    } catch (e) {}
  }

  function clearEventBodyClasses() {
    var body = document.body;
    for (var i = 0; i < EVENT_BODY_CLASSES.length; i++) {
      body.classList.remove(EVENT_BODY_CLASSES[i]);
    }
  }

  /** Визуальные классы событий на body (не смешивать с игровой логикой). */
  function syncEventFeedback() {
    clearEventBodyClasses();
    if (phase === "idle" || phase === "casting") return;
    var map = {
      noCatch: "event-no-catch",
      smallCatch: "event-small-catch",
      bite: "event-bite",
      reeling: "event-reeling",
      cashedOut: "event-win",
      snapped: "event-snap",
    };
    var cls = map[phase];
    if (cls) document.body.classList.add(cls);
    if (phase === "reeling") {
      var fightSec = reelWallStartMs ? (Date.now() - reelWallStartMs) / 1000 : 0;
      if (fightSec > 2.2 && resistanceMeterPercent() > 72) {
        document.body.classList.add("event-intense");
      }
    }
  }

  /** Текущий выигрыш = ставка × множитель, без копеек */
  function currentWin() {
    return Math.floor(betLocked * currentMultiplier);
  }

  function formatMoney(n) {
    return Math.floor(n).toLocaleString("ru-RU");
  }

  function formatMult(x) {
    return "×" + x.toFixed(2);
  }

  /** Ставка: шаг, лимиты и не больше доступного баланса */
  function clampBet() {
    let b = Math.round(bet / BET_STEP) * BET_STEP;
    b = Math.min(BET_MAX, b);
    const affordable = Math.floor(balance / BET_STEP) * BET_STEP;
    b = Math.min(b, affordable);
    if (b < BET_MIN) {
      b = balance >= BET_MIN ? BET_MIN : Math.max(0, affordable);
    }
    bet = b;
  }

  function refreshMoneyUI() {
    els.balanceDisplay.textContent = formatMoney(balance);
    els.betDisplay.textContent = formatMoney(bet);
    els.betDisplayTop.textContent = formatMoney(bet);
  }

  /**
   * Исход заброса после casting: 40% пусто, 20% мелочь, 40% рыба (вид — только через pickFish()).
   * @returns {{ type: 'noCatch' } | { type: 'smallCatch' } | { type: 'fish' }}
   */
  function rollCastOutcome() {
    const r = Math.random() * 100;
    if (r < 40) return { type: "noCatch" };
    if (r < 60) return { type: "smallCatch" };
    return { type: "fish" };
  }

  /** Случайная рыба по полю chance (только при outcome.type === "fish"). */
  function pickFish() {
    const total = fishTypes.reduce(function (sum, f) {
      return sum + f.chance;
    }, 0);
    let r = Math.random() * total;
    for (let i = 0; i < fishTypes.length; i++) {
      r -= fishTypes[i].chance;
      if (r <= 0) return fishTypes[i];
    }
    return fishTypes[fishTypes.length - 1];
  }

  /**
   * Точка обрыва выше стартового множителя, чаще близко к старту, редко к x20.
   * @param {number} startMultiplier
   */
  function generateCrashPoint(startMultiplier) {
    const maxCrash = CRASH_MULT_CAP;
    const headroom = maxCrash - startMultiplier;
    if (headroom <= 0.02) {
      return Math.min(startMultiplier + 0.02, maxCrash);
    }
    const u = Math.max(1e-9, Math.random());
    const v = Math.max(1e-9, Math.random());
    const expo = -Math.log(u) * 0.42;
    const t = 1 - Math.exp(-expo);
    const jitter = 0.12 + 0.88 * Math.pow(v, 1.35);
    let crash = startMultiplier + t * jitter * headroom;
    crash = Math.max(crash, startMultiplier + 0.03 + Math.random() * startMultiplier * 0.04);
    return Math.min(crash, maxCrash);
  }

  /**
   * Атмосферный индикатор «сопротивление»: crashPoint нигде не участвует.
   * Зависит от времени борьбы, прироста множителя относительно старта рыбы, вида рыбы и фазы раунда.
   * @returns {number} 0–100 для полоски UI (не расстояние и не доля пути до обрыва).
   */
  function resistanceMeterPercent() {
    if (phase !== "reeling" || !currentFish || !reelWallStartMs) return 0;
    var t = (Date.now() - reelWallStartMs) / 1000;
    var sm = currentFish.startMultiplier;
    var lift = Math.max(0, currentMultiplier - sm);
    var r = resistanceVisualSeed;
    var wobble =
      Math.sin(t * 2.35 + r) * 26 +
      Math.sin(t * 0.58 + r * 1.73) * 19 +
      Math.sin(t * sm * 0.31 + r * 2.2) * 15;
    var liftRipple = Math.sin(lift * 2.8 + t * 2.05 + sm * 0.42 + r) * 17;
    var fishFight = Math.sin(t * sm * 0.21 + r * 2.2) * 14;
    var elapsedPulse = Math.sin(t * 0.95 + r) * 12;
    var timeStir = Math.min(24, t * 3.5);
    var liftBias = Math.min(26, lift * (5 / sm));
    var raw = 34 + timeStir + liftBias + wobble + liftRipple + fishFight + elapsedPulse;
    return Math.min(100, Math.max(6, raw));
  }

  /** Классы режима игры на body (простая обратная связь) */
  function syncBodyClasses() {
    const body = document.body;
    body.classList.remove(
      "is-casting",
      "is-bite",
      "is-reeling",
      "is-intense",
      "is-win",
      "is-snap"
    );
    var resistPct = resistanceMeterPercent();
    if (phase === "casting") body.classList.add("is-casting");
    if (phase === "bite") body.classList.add("is-bite");
    if (phase === "reeling") {
      body.classList.add("is-reeling");
      var fs = reelWallStartMs ? (Date.now() - reelWallStartMs) / 1000 : 0;
      if (fs > 2.2 && resistPct > 74) body.classList.add("is-intense");
    }
    if (phase === "cashedOut") body.classList.add("is-win");
    if (phase === "snapped") body.classList.add("is-snap");
  }

  /** Текст статуса по state machine */
  function syncStatusText() {
    switch (phase) {
      case "idle":
        els.statusText.textContent = "Выберите ставку и сделайте заброс.";
        break;
      case "casting":
        els.statusText.textContent = "Заброс удочки...";
        break;
      case "noCatch":
        els.statusText.textContent = "Пустой заброс. Рыба не клюнула.";
        break;
      case "smallCatch":
        els.statusText.textContent =
          "Мелкий клёв. Возврат " + formatMoney(currentWin()) + " ₸";
        break;
      case "bite":
        if (currentFish) {
          els.statusText.textContent =
            currentFish.name +
            " на крючке — " +
            formatMoney(currentWin()) +
            " ₸. Забери в садок или тяни дальше.";
        } else {
          els.statusText.textContent = "КЛЁВ!";
        }
        break;
      case "reeling":
        if (currentFish) {
          els.statusText.textContent =
            currentFish.name +
            " на крючке — " +
            formatMoney(currentWin()) +
            " ₸. Забери в садок или тяни дальше.";
        }
        break;
      case "cashedOut":
        els.statusText.textContent = "Улов в садке!";
        break;
      case "snapped":
        els.statusText.textContent = "Леска порвалась. Улов потерян.";
        break;
      default:
        break;
    }
  }

  /** Подпись под множителем: «Рыба на крючке — N ₸» (стартовый улов) */
  function syncFishLine() {
    if (phase === "bite" || phase === "reeling") {
      if (currentFish) {
        els.fishLine.textContent =
          currentFish.name + " на крючке — " + formatMoney(currentWin()) + " ₸";
      }
      return;
    }
    if (phase === "casting") {
      els.fishLine.innerHTML = "&nbsp;";
      return;
    }
    els.fishLine.innerHTML = "&nbsp;";
  }

  function updateFishingLine(tensionVisual, phaseKey) {
    const path = els.linePath;
    const wrap = els.lineWrap;
    if (!path || !wrap) return;

    /* Совмещено с якорем FP-удочки (зона «В САДОК»), viewBox лески 0–100 × 0–100 по вьюпорту */
    const tipX = 76.2;
    const tipY = 89.2;
    const hookX = 50;
    const hookY = 41;

    if (
      phaseKey === "idle" ||
      phaseKey === "casting" ||
      phaseKey === "noCatch" ||
      phaseKey === "smallCatch" ||
      phaseKey === "cashedOut" ||
      phaseKey === "snapped"
    ) {
      const sag = 69 + Math.sin(Date.now() / 900) * 1.2;
      path.setAttribute(
        "d",
        "M " + tipX + " " + tipY + " Q " + (tipX + hookX) / 2 + " " + sag + " " + hookX + " " + hookY
      );
      wrap.classList.remove("line-fp--taut");
      return;
    }

    wrap.classList.add("line-fp--taut");
    const pull = Math.max(0, Math.min(1, tensionVisual));
    const cx = (tipX + hookX) / 2 + pull * 7 - (1 - pull) * 4;
    const cy = 48 + (1 - pull) * 22 - pull * 10;
    path.setAttribute("d", "M " + tipX + " " + tipY + " Q " + cx + " " + cy + " " + hookX + " " + hookY);
  }

  /** Обновление индикатора «Сопротивление рыбы» (без crashPoint). */
  function updateResistanceVisual() {
    els.tensionFill.classList.remove(
      "resist-band-soft",
      "resist-band-medium",
      "resist-band-high"
    );

    if (phase !== "reeling") {
      els.tensionFill.style.width = "0%";
      if (els.waterZone) els.waterZone.classList.remove("resistance-intense");
      if (els.resistanceHint) els.resistanceHint.textContent = "\u00a0";
      return;
    }

    var pct = resistanceMeterPercent();
    els.tensionFill.style.width = pct + "%";

    var hint = "";
    if (pct < 38) {
      els.tensionFill.classList.add("resist-band-soft");
      hint = "Спокойное сопротивление";
    } else if (pct < 62) {
      els.tensionFill.classList.add("resist-band-medium");
      hint = "Рыба сопротивляется";
    } else {
      els.tensionFill.classList.add("resist-band-high");
      hint = "Сильные рывки";
    }
    if (els.resistanceHint) els.resistanceHint.textContent = hint;

    if (els.waterZone) els.waterZone.classList.toggle("resistance-intense", pct > 73);
  }

  function renderRoundVisuals() {
    const reeling = phase === "reeling";
    const bite = phase === "bite";
    const showMult = reeling || bite;

    els.multDisplay.textContent = formatMult(currentMultiplier);
    els.multDisplay.classList.toggle("dim", !showMult);

    if (reeling || bite) {
      els.catchDisplay.textContent = formatMoney(currentWin()) + " ₸";
    } else if (phase === "smallCatch") {
      els.multDisplay.textContent = formatMult(currentMultiplier);
      els.multDisplay.classList.remove("dim");
      els.catchDisplay.textContent = formatMoney(currentWin()) + " ₸";
    } else if (phase === "noCatch") {
      els.multDisplay.textContent = formatMult(1);
      els.multDisplay.classList.add("dim");
      els.catchDisplay.textContent = "0 ₸";
    } else if (
      phase === "idle" ||
      phase === "casting" ||
      phase === "cashedOut" ||
      phase === "snapped"
    ) {
      els.catchDisplay.textContent = "0 ₸";
    }

    updateResistanceVisual();

    var resistPct = resistanceMeterPercent();
    var rNorm = resistPct / 100;
    if (reeling) {
      var fightSecForVib = reelWallStartMs ? (Date.now() - reelWallStartMs) / 1000 : 0;
      if (fightSecForVib > 2 && resistPct > 82) {
        if (resistanceSpikeVibratePrimed) {
          resistanceSpikeVibratePrimed = false;
          triggerVibration([52]);
        }
      } else if (resistPct < 62) {
        resistanceSpikeVibratePrimed = true;
      }
    }

    if (els.lineWrap) els.lineWrap.classList.toggle("shake", reeling);
    els.btnCash.classList.toggle(
      "pulse-high",
      reeling && currentFish && currentMultiplier > currentFish.startMultiplier * 1.12
    );

    if (els.rodRig) {
      els.rodRig.classList.toggle("fp-rig--active", reeling || bite);
      els.rodRig.classList.toggle("fp-rig--bite", bite);
      els.rodRig.classList.toggle("fp-rig--bent", reeling && rNorm > 0.38);
      els.rodRig.classList.toggle("fp-rig--bent-hard", reeling && rNorm > 0.72);
    }

    let lineTension = 0;
    if (reeling) lineTension = rNorm;
    else if (bite) lineTension = 0.22;
    updateFishingLine(lineTension, phase);

    if (bite || reeling) {
      syncStatusText();
      syncFishLine();
    }

    if (els.biteCallout) {
      els.biteCallout.classList.toggle("bite-callout--show", bite);
    }

    syncBodyClasses();
    syncEventFeedback();
  }

  function flash(el, ms) {
    if (!el) return;
    el.classList.add("show");
    window.setTimeout(function () {
      el.classList.remove("show");
    }, ms);
  }

  /** История: последние 8, новые сверху */
  function pushHistory(html, className) {
    const row = document.createElement("div");
    row.className = "hist-item " + className;
    row.innerHTML = html;
    els.historyList.prepend(row);
    while (els.historyList.children.length > HISTORY_CAP) {
      els.historyList.removeChild(els.historyList.lastChild);
    }
  }

  /** Выигрыш: зелёный до ×2.5, иначе «золотой» стиль */
  function histClassWin(mult) {
    return mult < 2.5 ? "hist-win-green" : "hist-win-gold";
  }

  function resetLineSnapClass() {
    if (els.lineWrap) els.lineWrap.classList.remove("snap");
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastTs = 0;
    reelStartTs = 0;
  }

  function syncButtons() {
    const idle = phase === "idle";
    const reeling = phase === "reeling";

    els.btnCast.disabled = !idle;
    els.btnCash.disabled = !reeling;

    els.betMinus.disabled = !idle;
    els.betPlus.disabled = !idle;

    syncAutoCashoutUI();
  }

  /**
   * UI автокэшаута; пресеты доступны только в idle.
   * Срабатывание: см. maybeAutoCashOut, цикл loop и scheduleAutoCashoutIfStartAlreadyHigh.
   */
  function syncAutoCashoutUI() {
    if (!els.autoCashoutToggle || !els.autoCashoutState || !els.autoCashoutMult || !els.autoPresets) {
      return;
    }
    els.autoCashoutToggle.setAttribute("aria-pressed", autoCashoutEnabled ? "true" : "false");
    els.autoCashoutState.textContent = autoCashoutEnabled ? "ON" : "OFF";
    els.autoCashoutMult.textContent = formatMult(autoCashoutValue);

    var idle = phase === "idle";
    var presetBtns = els.autoPresets.querySelectorAll(".btn-preset");
    for (var i = 0; i < presetBtns.length; i++) {
      var btn = presetBtns[i];
      var raw = btn.getAttribute("data-mult");
      var v = raw ? parseFloat(raw) : NaN;
      btn.disabled = !idle;
      btn.classList.toggle("is-active", !isNaN(v) && Math.abs(v - autoCashoutValue) < 1e-6);
    }
  }

  function maybeAutoCashOut() {
    if (!autoCashoutEnabled || phase !== "reeling") return;
    if (currentMultiplier + 1e-9 >= autoCashoutValue) {
      cashOut();
    }
  }

  /** Если старт рыбы уже ≥ цели — короткая задержка после входа в reeling, затем cashOut. */
  function scheduleAutoCashoutIfStartAlreadyHigh() {
    if (!autoCashoutEnabled || !currentFish) return;
    if (currentFish.startMultiplier + 1e-9 < autoCashoutValue) return;
    var delay = 150 + Math.random() * 100;
    window.setTimeout(function () {
      if (phase !== "reeling") return;
      if (!autoCashoutEnabled) return;
      maybeAutoCashOut();
    }, delay);
  }

  /** Возврат в idle: сброс переменных раунда */
  function enterIdle() {
    phase = "idle";
    stopLoop();
    currentFish = null;
    crashPoint = Infinity;
    betLocked = 0;
    currentMultiplier = 1;
    resistanceSpikeVibratePrimed = true;
    reelWallStartMs = 0;
    resistanceVisualSeed = 0;

    els.fishSilhouette.classList.remove("visible");
    if (els.lineWrap) els.lineWrap.classList.remove("shake", "snap", "line-fp--taut");
    if (els.waterZone) els.waterZone.classList.remove("resistance-intense", "risk-shake");
    els.btnCash.classList.remove("pulse-high");
    if (els.rodRig) {
      els.rodRig.classList.remove(
        "fp-rig--active",
        "fp-rig--bite",
        "fp-rig--bent",
        "fp-rig--bent-hard"
      );
    }

    els.multDisplay.textContent = formatMult(1);
    els.multDisplay.classList.add("dim");
    els.catchDisplay.textContent = "0 ₸";
    els.fishLine.innerHTML = "&nbsp;";
    els.tensionFill.style.width = "0%";
    els.tensionFill.classList.remove("resist-band-soft", "resist-band-medium", "resist-band-high");
    if (els.resistanceHint) els.resistanceHint.innerHTML = "&nbsp;";

    document.body.classList.remove(
      "is-casting",
      "is-bite",
      "is-reeling",
      "is-intense",
      "is-win",
      "is-snap"
    );
    clearEventBodyClasses();
    if (els.biteCallout) els.biteCallout.classList.remove("bite-callout--show");

    clampBet();
    refreshMoneyUI();
    syncButtons();
    syncStatusText();
    syncFishLine();
    updateFishingLine(0, "idle");
  }

  function loop(ts) {
    if (phase !== "reeling") return;
    if (!lastTs) lastTs = ts;
    if (!reelStartTs) reelStartTs = ts;
    const dt = Math.min(32, ts - lastTs) / 1000;
    lastTs = ts;

    var elapsed = (ts - reelStartTs) / 1000;
    const sm = currentFish ? currentFish.startMultiplier : 1;
    const base = 0.028 * sm;
    const accel = 0.011 * sm;
    var tFight = reelWallStartMs ? (Date.now() - reelWallStartMs) / 1000 : 0;
    /* Ускорение роста множителя: только время и «борьба», без crashPoint. */
    var struggleBoost =
      (0.38 + 0.62 * Math.sin(tFight * sm * 0.19 + resistanceVisualSeed)) * 0.048 * sm;
    const deltaMult = (base + accel * elapsed + struggleBoost) * dt;

    currentMultiplier += deltaMult;

    if (currentMultiplier >= crashPoint) {
      currentMultiplier = crashPoint;
      renderRoundVisuals();
      snap();
      return;
    }

    /* Автокэшаут: включённый toggle + множитель ≥ цели → cashOut() (то же условие в maybeAutoCashOut для toggle/таймера). */
    if (autoCashoutEnabled && currentMultiplier + 1e-9 >= autoCashoutValue) {
      renderRoundVisuals();
      cashOut();
      return;
    }

    renderRoundVisuals();
    rafId = requestAnimationFrame(loop);
  }

  function snap() {
    stopLoop();
    phase = "snapped";

    els.btnCast.disabled = true;
    els.btnCash.disabled = true;
    if (els.lineWrap) els.lineWrap.classList.remove("shake");
    if (els.lineWrap) els.lineWrap.classList.add("snap");
    window.setTimeout(resetLineSnapClass, 400);

    els.catchDisplay.textContent = "0 ₸";
    flash(els.flashRed, 380);
    triggerVibration([180]);

    if (els.rodRig) {
      els.rodRig.classList.remove(
        "fp-rig--active",
        "fp-rig--bite",
        "fp-rig--bent",
        "fp-rig--bent-hard"
      );
    }

    const snapMult = currentMultiplier;
    pushHistory("<span>Обрыв x" + snapMult.toFixed(2) + "</span>", "hist-snap");

    syncStatusText();
    syncFishLine();
    syncBodyClasses();
    renderRoundVisuals();

    window.setTimeout(enterIdle, ROUND_END_MS);
  }

  function cashOut() {
    if (phase !== "reeling") return;
    stopLoop();
    phase = "cashedOut";

    const mult = currentMultiplier;
    const payout = currentWin();
    balance += payout;

    els.btnCast.disabled = true;
    els.btnCash.disabled = true;
    if (els.lineWrap) els.lineWrap.classList.remove("shake");
    if (els.waterZone) els.waterZone.classList.remove("resistance-intense", "risk-shake");
    els.btnCash.classList.remove("pulse-high");

    if (els.rodRig) {
      els.rodRig.classList.remove(
        "fp-rig--active",
        "fp-rig--bite",
        "fp-rig--bent",
        "fp-rig--bent-hard"
      );
    }

    flash(els.flashGold, 380);
    triggerVibration([80, 50, 120]);
    updateFishingLine(0, "cashedOut");

    const name = currentFish ? currentFish.name : "";
    pushHistory(
      "<span>" +
        name +
        " x" +
        mult.toFixed(2) +
        " +" +
        formatMoney(payout) +
        " ₸</span>",
      histClassWin(mult)
    );

    refreshMoneyUI();
    syncStatusText();
    syncFishLine();
    syncBodyClasses();
    renderRoundVisuals();

    window.setTimeout(enterIdle, ROUND_END_MS);
  }

  function startReeling() {
    crashPoint = generateCrashPoint(currentFish.startMultiplier);
    currentMultiplier = currentFish.startMultiplier;
    phase = "reeling";
    reelStartTs = 0;
    reelWallStartMs = Date.now();
    resistanceVisualSeed = Math.random() * Math.PI * 2;
    resistanceSpikeVibratePrimed = true;

    els.multDisplay.classList.remove("dim");
    els.fishSilhouette.classList.add("visible");

    syncButtons();
    syncStatusText();
    syncFishLine();
    lastTs = 0;
    renderRoundVisuals();
    scheduleAutoCashoutIfStartAlreadyHigh();
    rafId = requestAnimationFrame(loop);
  }

  function cast() {
    if (phase !== "idle") return;

    clampBet();
    if (bet > balance || bet < BET_MIN) {
      els.statusText.textContent = "Недостаточно средств или некорректная ставка.";
      refreshMoneyUI();
      return;
    }

    balance -= bet;
    betLocked = bet;
    refreshMoneyUI();

    phase = "casting";
    syncButtons();
    syncStatusText();
    syncFishLine();

    els.multDisplay.classList.add("dim");
    els.multDisplay.textContent = formatMult(1);
    els.catchDisplay.textContent = "0 ₸";
    renderRoundVisuals();

    const delay = 800 + Math.random() * 400;

    window.setTimeout(function () {
      if (phase !== "casting") return;

      currentFish = null;
      var outcome = rollCastOutcome();
      console.log("Cast outcome:", outcome.type);

      if (outcome.type === "noCatch") {
        phase = "noCatch";
        currentMultiplier = 1;
        playReelWindTicks();
        pushHistory("<span>Пусто −" + formatMoney(betLocked) + " ₸</span>", "hist-empty");
        syncButtons();
        syncStatusText();
        syncFishLine();
        renderRoundVisuals();
        window.setTimeout(function () {
          if (phase !== "noCatch") return;
          enterIdle();
        }, MINOR_ROUND_MS);
        return;
      }

      if (outcome.type === "smallCatch") {
        phase = "smallCatch";
        currentMultiplier = 0.3 + Math.random() * 0.5;
        var smallWin = Math.floor(betLocked * currentMultiplier);
        balance += smallWin;
        if (els.flashSoftCyan) flash(els.flashSoftCyan, 260);
        pushHistory(
          "<span>Мелочь x" +
            currentMultiplier.toFixed(2) +
            " +" +
            formatMoney(smallWin) +
            " ₸</span>",
          "hist-small"
        );
        refreshMoneyUI();
        syncButtons();
        syncStatusText();
        syncFishLine();
        renderRoundVisuals();
        window.setTimeout(function () {
          if (phase !== "smallCatch") return;
          enterIdle();
        }, MINOR_ROUND_MS);
        return;
      }

      currentFish = pickFish();
      phase = "bite";
      currentMultiplier = currentFish.startMultiplier;
      if (els.flashBite) flash(els.flashBite, 320);
      triggerVibration([100, 40, 140]);

      syncButtons();
      syncStatusText();
      syncFishLine();

      els.multDisplay.textContent = formatMult(currentMultiplier);
      els.multDisplay.classList.remove("dim");
      els.catchDisplay.textContent = formatMoney(currentWin()) + " ₸";
      renderRoundVisuals();

      window.setTimeout(function () {
        if (phase !== "bite") return;
        startReeling();
      }, 550);
    }, delay);
  }

  /** История панели mobile/desktop */
  function syncHistoryLayout() {
    const wide = window.matchMedia("(min-width: 901px)").matches;
    if (!els.historyPanel || !els.histToggle) return;
    if (wide) {
      els.historyPanel.classList.remove("collapsed");
      els.histToggle.setAttribute("aria-expanded", "true");
    } else {
      els.historyPanel.classList.add("collapsed");
      els.histToggle.setAttribute("aria-expanded", "false");
    }
  }

  els.betMinus.addEventListener("click", function () {
    if (phase !== "idle") return;
    bet -= BET_STEP;
    clampBet();
    refreshMoneyUI();
  });

  els.betPlus.addEventListener("click", function () {
    if (phase !== "idle") return;
    bet += BET_STEP;
    clampBet();
    refreshMoneyUI();
  });

  els.btnCast.addEventListener("click", cast);
  els.btnCash.addEventListener("click", cashOut);

  if (els.autoCashoutToggle) {
    els.autoCashoutToggle.addEventListener("click", function () {
      autoCashoutEnabled = !autoCashoutEnabled;
      syncAutoCashoutUI();
      maybeAutoCashOut();
    });
  }

  if (els.autoPresets) {
    els.autoPresets.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".btn-preset");
      if (!btn || phase !== "idle") return;
      var raw = btn.getAttribute("data-mult");
      var v = raw ? parseFloat(raw) : NaN;
      if (isNaN(v)) return;
      autoCashoutValue = v;
      syncAutoCashoutUI();
    });
  }

  if (els.histToggle && els.historyPanel) {
    els.histToggle.addEventListener("click", function () {
      els.historyPanel.classList.toggle("collapsed");
      const open = !els.historyPanel.classList.contains("collapsed");
      els.histToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  window.addEventListener("resize", syncHistoryLayout);

  clampBet();
  refreshMoneyUI();
  syncHistoryLayout();
  syncButtons();
  syncStatusText();
  syncAutoCashoutUI();
  renderRoundVisuals();

  window.setInterval(function () {
    if (
      phase === "idle" ||
      phase === "casting" ||
      phase === "noCatch" ||
      phase === "smallCatch"
    ) {
      updateFishingLine(0, phase);
    }
  }, 120);
})();
