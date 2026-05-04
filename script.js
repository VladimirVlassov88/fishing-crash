(function () {
  "use strict";

  /**
   * @typedef {'idle'|'casting'|'bite'|'reeling'|'cashedOut'|'snapped'} GameState
   * @typedef {{ id: string, name: string, chance: number, startMultiplier: number, color: string }} FishType
   */

  const fishTypes = [
    { id: "crucian", name: "Карась", chance: 45, startMultiplier: 1.2, color: "green" },
    { id: "perch", name: "Окунь", chance: 30, startMultiplier: 2, color: "blue" },
    { id: "pike", name: "Щука", chance: 15, startMultiplier: 3.5, color: "purple" },
    { id: "catfish", name: "Сом", chance: 8, startMultiplier: 6, color: "orange" },
    { id: "goldfish", name: "Золотая рыба", chance: 2, startMultiplier: 10, color: "gold" },
  ];

  const BET_MIN = 100;
  const BET_MAX = 5000;
  const BET_STEP = 100;
  const START_BALANCE = 10000;
  const HISTORY_CAP = 8;
  /** Пауза перед возвратом в idle после исхода раунда */
  const ROUND_END_MS = 1500;
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
    tensionNeedle: document.getElementById("tensionNeedle"),
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

  /** Стартовый выигрыш в ₸ при текущей ставке и рыбе */
  function startWinAmount() {
    if (!currentFish || !betLocked) return 0;
    return Math.floor(betLocked * currentFish.startMultiplier);
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

  /** Случайная рыба по полю chance */
  function pickFish() {
    const total = fishTypes.reduce(function (s, f) {
      return s + f.chance;
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

  /** Натяжение 0–100 по формуле ТЗ */
  function tensionPercent() {
    if (phase !== "reeling" || crashPoint <= 0) return 0;
    return Math.min(100, Math.max(0, (currentMultiplier / crashPoint) * 100));
  }

  /** Классы режима игры на body (простая обратная связь) */
  function syncBodyClasses() {
    const body = document.body;
    body.classList.remove(
      "is-casting",
      "is-bite",
      "is-reeling",
      "is-danger",
      "is-win",
      "is-snap"
    );
    const pct = tensionPercent();
    if (phase === "casting") body.classList.add("is-casting");
    if (phase === "bite") body.classList.add("is-bite");
    if (phase === "reeling") {
      body.classList.add("is-reeling");
      if (pct >= 80) body.classList.add("is-danger");
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
      case "bite":
        els.statusText.textContent = "КЛЁВ!";
        break;
      case "reeling":
        if (currentFish) {
          els.statusText.textContent =
            currentFish.name + " на крючке — забери в садок или тяни дальше.";
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
          currentFish.name + " на крючке — " + formatMoney(startWinAmount()) + " ₸";
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

  /** Обновление шкалы натяжения и зон цвета */
  function updateTensionVisual() {
    els.tensionFill.classList.remove("tension-zone-low", "tension-zone-mid", "tension-zone-high");

    if (phase !== "reeling") {
      els.tensionFill.style.width = "0%";
      els.tensionNeedle.style.left = "0%";
      if (els.waterZone) els.waterZone.classList.remove("danger");
      return;
    }

    const pct = tensionPercent();
    els.tensionFill.style.width = pct + "%";
    els.tensionNeedle.style.left = pct + "%";

    if (pct < 50) els.tensionFill.classList.add("tension-zone-low");
    else if (pct < 80) els.tensionFill.classList.add("tension-zone-mid");
    else els.tensionFill.classList.add("tension-zone-high");

    if (els.waterZone) els.waterZone.classList.toggle("danger", pct >= 80);
  }

  function renderRoundVisuals() {
    const reeling = phase === "reeling";
    const bite = phase === "bite";
    const showMult = reeling || bite;

    els.multDisplay.textContent = formatMult(currentMultiplier);
    els.multDisplay.classList.toggle("dim", !showMult);

    if (reeling || bite) {
      els.catchDisplay.textContent = formatMoney(currentWin()) + " ₸";
    } else if (
      phase === "idle" ||
      phase === "casting" ||
      phase === "cashedOut" ||
      phase === "snapped"
    ) {
      els.catchDisplay.textContent = "0 ₸";
    }

    updateTensionVisual();

    const tNorm = tensionPercent() / 100;
    els.lineWrap.classList.toggle("shake", reeling);
    els.btnCash.classList.toggle("pulse-high", reeling && tensionPercent() >= 75);

    if (els.rodRig) {
      els.rodRig.classList.toggle("fp-rig--active", reeling || bite);
      els.rodRig.classList.toggle("fp-rig--bite", bite);
      els.rodRig.classList.toggle("fp-rig--bent", reeling && tNorm > 0.35);
      els.rodRig.classList.toggle("fp-rig--bent-hard", reeling && tNorm > 0.72);
    }

    let lineTension = 0;
    if (reeling) lineTension = tNorm;
    else if (bite) lineTension = 0.22;
    updateFishingLine(lineTension, phase);

    syncBodyClasses();
  }

  function flash(el, ms) {
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
    els.lineWrap.classList.remove("snap");
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

    els.fishSilhouette.classList.remove("visible");
    els.lineWrap.classList.remove("shake", "snap", "line-fp--taut");
    if (els.waterZone) els.waterZone.classList.remove("danger", "risk-shake");
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
    els.tensionNeedle.style.left = "0%";
    els.tensionFill.classList.remove("tension-zone-low", "tension-zone-mid", "tension-zone-high");

    document.body.classList.remove(
      "is-casting",
      "is-bite",
      "is-reeling",
      "is-danger",
      "is-win",
      "is-snap"
    );

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

    const elapsed = (ts - reelStartTs) / 1000;
    const sm = currentFish ? currentFish.startMultiplier : 1;
    const base = 0.028 * sm;
    const accel = 0.011 * sm;
    const dangerBoost = (tensionPercent() / 100) * 0.06 * sm;
    const deltaMult = (base + accel * elapsed + dangerBoost) * dt;

    currentMultiplier += deltaMult;

    if (currentMultiplier >= crashPoint) {
      currentMultiplier = crashPoint;
      renderRoundVisuals();
      snap();
      return;
    }

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
    els.lineWrap.classList.remove("shake");
    els.lineWrap.classList.add("snap");
    window.setTimeout(resetLineSnapClass, 400);

    els.catchDisplay.textContent = "0 ₸";
    flash(els.flashRed, 380);

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
    els.lineWrap.classList.remove("shake");
    if (els.waterZone) els.waterZone.classList.remove("danger", "risk-shake");
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

      currentFish = pickFish();
      phase = "bite";
      currentMultiplier = currentFish.startMultiplier;

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
    if (phase === "idle" || phase === "casting") updateFishingLine(0, phase);
  }, 120);
})();
