(function () {
  "use strict";

  /**
   * @typedef {'idle'|'casting'|'noCatch'|'smallCatch'|'bite'|'reeling'|'cashedOut'|'snapped'} GameState
   * @typedef {{ id: string, name: string, chance: number, startMultiplier: number, color: string }} FishType
   */

  /** Единые пути к исходным PNG (preload + canvas; в UI не подставляются). */
  const fishImages = {
    malek: "./assets/fish/fish_malek.png",
    karas: "./assets/fish/fish_karas.png",
    okun: "./assets/fish/fish_okun.png",
    shuka: "./assets/fish/fish_shuka.png",
    som: "./assets/fish/fish_som.png",
    gold: "./assets/fish/fish_gold.png",
  };

  /** Игровой id рыбы или "malek" → ключ fishImages / cleanedFishImages */
  const GAME_ID_TO_IMAGE_KEY = {
    malek: "malek",
    crucian: "karas",
    perch: "okun",
    pike: "shuka",
    catfish: "som",
    goldfish: "gold",
  };

  /** Кэш data URL после removeWhiteBackground (ключи malek, karas, …). Только они попадают в UI. */
  const cleanedFishImages = {};

  /** Пороги canvas: >230 по всем каналам → alpha 0; >210 — мягкое снижение alpha до края 230. */
  var FISH_WHITE_HARD = 230;
  var FISH_WHITE_SOFT = 210;

  /**
   * Убирает близкий к белому фон у PNG через canvas (альфа → 0).
   * @param {string} src URL или data URL
   * @returns {Promise<string>} image/png data URL
   */
  async function removeWhiteBackground(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth;
          var h = img.naturalHeight;
          if (!w || !h) {
            reject(new Error("zero size"));
            return;
          }
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("no 2d context"));
            return;
          }
          ctx.drawImage(img, 0, 0);
          var imageData = ctx.getImageData(0, 0, w, h);
          var d = imageData.data;
          var HARD = FISH_WHITE_HARD;
          var SOFT = FISH_WHITE_SOFT;
          var span = HARD - SOFT;
          for (var i = 0; i < d.length; i += 4) {
            var r = d[i];
            var g = d[i + 1];
            var b = d[i + 2];
            var a = d[i + 3];
            if (r > HARD && g > HARD && b > HARD) {
              d[i + 3] = 0;
            } else if (r > SOFT && g > SOFT && b > SOFT) {
              var m = Math.min(r, g, b);
              var t = (m - SOFT) / span;
              if (t < 0) t = 0;
              if (t > 1) t = 1;
              d[i + 3] = Math.round(a * (1 - t));
            }
          }
          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () {
        reject(new Error("image load failed"));
      };
      img.src = src;
    });
  }

  /** Предзагрузка исходных PNG перед очисткой canvas (не используется в UI напрямую). */
  function preloadFishImages() {
    var keys = Object.keys(fishImages);
    return Promise.all(
      keys.map(function (key) {
        return new Promise(function (resolve) {
          var path = fishImages[key];
          var im = new Image();
          im.onload = function () {
            if (im.decode && typeof im.decode === "function") {
              im.decode().then(resolve).catch(resolve);
            } else {
              resolve();
            }
          };
          im.onerror = function () {
            console.warn("[fish preload] failed:", key, path);
            resolve();
          };
          im.src = path;
        });
      })
    );
  }

  /** Прогон всех рыб через removeWhiteBackground → cleanedFishImages (data URL). */
  async function buildCleanedFishImages() {
    var keys = Object.keys(fishImages);
    await Promise.all(
      keys.map(function (key) {
        var path = fishImages[key];
        return removeWhiteBackground(path).then(
          function (dataUrl) {
            cleanedFishImages[key] = dataUrl;
          },
          function () {
            console.warn("[fish icon clean] failed:", key, path);
          }
        );
      })
    );
  }

  function fishIconSrc(gameFishId) {
    var imgKey = gameFishId && GAME_ID_TO_IMAGE_KEY[gameFishId];
    if (!imgKey) return "";
    var u = cleanedFishImages[imgKey];
    return typeof u === "string" && u.length ? u : "";
  }

  function markFishImgLoaded(img) {
    if (!img || img.tagName !== "IMG") return;
    img.classList.add("is-loaded");
    var host = img.closest(".fish-icon-host");
    if (host) {
      host.classList.add("fish-icon-host--ready");
      host.querySelectorAll(".fish-icon-skeleton--hudStatus, .fish-icon-skeleton--hudLine").forEach(function (sk) {
        sk.remove();
      });
    }
  }

  function bindFishImgLoaded(img) {
    if (!img) return;
    img.addEventListener(
      "load",
      function fishImgOnLoad() {
        markFishImgLoaded(img);
      },
      { once: true }
    );
  }

  /**
   * При ошибке загрузки img — маркер без поломки вёрстки.
   * @param {"panel"|"hist"|"hudStatus"|"hudLine"|"reward"} slot
   */
  function attachFishIconErrorFallback(img, slot, ariaLabel) {
    img.addEventListener(
      "error",
      function handleFishIconImgError() {
        img.removeEventListener("error", handleFishIconImgError);
        var gid = img.getAttribute("data-fish-game-id");
        var ik = gid ? GAME_ID_TO_IMAGE_KEY[gid] : "";
        console.warn("[fish icon] failed to load UI asset:", gid || slot, ik ? fishImages[ik] : img.src.slice(0, 72));
        var host = img.closest(".fish-icon-host");
        if (host) host.classList.add("fish-icon-host--ready");
        var fb = document.createElement("span");
        fb.className = "fish-icon-fallback fish-icon-fallback--" + slot;
        fb.textContent = "\uD83D\uDC1F";
        fb.setAttribute("role", "img");
        fb.setAttribute("aria-label", ariaLabel || "Рыба");
        img.replaceWith(fb);
        if (host) {
          host.querySelectorAll(".fish-icon-skeleton").forEach(function (sk) {
            sk.remove();
          });
        }
      },
      { once: true }
    );
  }

  function initFishPanelIcons() {
    document.querySelectorAll(".fish-icon-host.fish-icon-host--panel[data-fish-game-id]").forEach(function (host) {
      var gid = host.getAttribute("data-fish-game-id");
      var alt = host.getAttribute("data-fish-alt") || "Рыба";
      var key = GAME_ID_TO_IMAGE_KEY[gid];
      host.classList.remove("fish-icon-host--ready");
      host.querySelectorAll("img.fish-icon--panel, span.fish-icon-fallback").forEach(function (node) {
        node.remove();
      });
      var url = fishIconSrc(gid);
      if (url) {
        var img = document.createElement("img");
        img.className = "fish-icon fish-icon--panel";
        img.setAttribute("data-fish-game-id", gid);
        img.alt = alt;
        img.decoding = "async";
        img.loading = "eager";
        bindFishImgLoaded(img);
        attachFishIconErrorFallback(img, "panel", alt);
        host.appendChild(img);
        img.src = url;
      } else {
        console.warn("[fish icon] no cleaned asset for panel:", gid, key ? fishImages[key] : "");
        host.classList.add("fish-icon-host--ready");
        var fb = document.createElement("span");
        fb.className = "fish-icon-fallback fish-icon-fallback--panel";
        fb.textContent = "\uD83D\uDC1F";
        fb.setAttribute("role", "img");
        fb.setAttribute("aria-label", alt);
        host.appendChild(fb);
      }
    });
  }

  /** Обновить src у строк истории, созданных до готовности cleanedFishImages. */
  function refreshHistoryFishIcons() {
    if (!els.historyList) return;
    els.historyList.querySelectorAll(".hist-item__fish-wrap[data-fish-game-id]").forEach(function (wrap) {
      var gid = wrap.getAttribute("data-fish-game-id");
      var url = fishIconSrc(gid);
      if (!url) return;
      var existing = wrap.querySelector("img.fish-icon--hist");
      if (existing) {
        if (existing.src !== url) {
          bindFishImgLoaded(existing);
          attachFishIconErrorFallback(existing, "hist", "Рыба");
          existing.src = url;
        }
        return;
      }
      wrap.classList.remove("fish-icon-host--ready");
      wrap.replaceChildren();
      var skH = document.createElement("span");
      skH.className = "fish-icon-skeleton fish-icon-skeleton--hist";
      skH.setAttribute("aria-hidden", "true");
      var imgH = document.createElement("img");
      imgH.className = "fish-icon fish-icon--hist";
      imgH.setAttribute("data-fish-game-id", gid);
      imgH.alt = "Рыба";
      imgH.decoding = "async";
      imgH.loading = "eager";
      bindFishImgLoaded(imgH);
      attachFishIconErrorFallback(imgH, "hist", "Рыба");
      imgH.src = url;
      wrap.appendChild(skH);
      wrap.appendChild(imgH);
    });
  }

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
  /** Пустой заброс и малёк: ровно 1.2 с перед idle */
  const MINOR_ROUND_MS = 1200;
  /** Длительности одноразового FX при fish (только визуал). */
  const BITE_SPLASH_ANIM_MS = 920;
  const BITE_CALLOUT_BURST_MS = 920;
  const BITE_SCREEN_SHAKE_MS = 215;
  const BITE_SCENE_FLASH_MS = 420;
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
    hudCenter: document.getElementById("hudCenter"),
    historyList: document.getElementById("historyList"),
    historyPanel: document.getElementById("historyPanel"),
    histToggle: document.getElementById("histToggle"),
    btnCast: document.getElementById("btnCast"),
    btnCash: document.getElementById("btnCash"),
    betMinus: document.getElementById("betMinus"),
    betPlus: document.getElementById("betPlus"),
    betPresets: document.getElementById("betPresets"),
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
    biteSplash: document.getElementById("biteSplash"),
    resistanceHud: document.getElementById("resistanceHud"),
    biteSceneFlash: document.getElementById("biteSceneFlash"),
    rewardPopupLayer: document.getElementById("rewardPopupLayer"),
    autoCashoutToggle: document.getElementById("autoCashoutToggle"),
    autoCashoutState: document.getElementById("autoCashoutState"),
    autoCashoutMult: document.getElementById("autoCashoutMult"),
    autoMultMinus: document.getElementById("autoMultMinus"),
    autoMultPlus: document.getElementById("autoMultPlus"),
    autoPresets: document.getElementById("autoPresets"),
    hudIdleStack: document.getElementById("hudIdleStack"),
    fightChart: document.getElementById("fightChart"),
    fightChartCurve: document.getElementById("fightChartCurve"),
    fightChartArea: document.getElementById("fightChartArea"),
    fightChartDot: document.getElementById("fightChartDot"),
    fightChartHint: document.getElementById("fightChartHint"),
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
  /** Замороженный прогресс «разворота» графика по времени боя (без crashPoint). Снимки для freeze после раунда. */
  let fightChartSweepFrozen = 0.06;
  let fightChartFightElapsedFrozen = 0;

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

  /**
   * Награда: новый узел; внешний .reward-popup — только translate+opacity, внутренний — scale+glow.
   * @param {"small"|"cashout"} kind
   * @param {string} amountFormatted — уже отформатированная сумма (formatMoney)
   * @param {string} [fishId] — для cashout: id из fishTypes
   */
  function showRewardPopup(kind, amountFormatted, fishId) {
    if (!els.rewardPopupLayer) return;

    var iconKey = kind === "small" ? "malek" : fishId;
    var src = fishIconSrc(iconKey);

    var el = document.createElement("div");
    el.className = "reward-popup";
    el.setAttribute("role", "status");

    var inner = document.createElement("div");
    inner.className =
      "reward-popup__inner reward-popup__inner--" + (kind === "small" ? "small" : "cashout");

    var iconWrap = document.createElement("span");
    iconWrap.className = "fish-icon-host fish-icon-host--reward";

    if (src) {
      var skR = document.createElement("span");
      skR.className = "fish-icon-skeleton fish-icon-skeleton--reward";
      skR.setAttribute("aria-hidden", "true");
      var img = document.createElement("img");
      img.className = "reward-popup__fish";
      img.alt = "Рыба";
      img.decoding = "async";
      img.loading = "eager";
      bindFishImgLoaded(img);
      attachFishIconErrorFallback(img, "reward", "Рыба");
      img.src = src;
      iconWrap.appendChild(skR);
      iconWrap.appendChild(img);
    } else {
      var ik = GAME_ID_TO_IMAGE_KEY[iconKey];
      console.warn("[fish icon] reward popup: no cleaned asset for", iconKey, ik ? fishImages[ik] : "");
      iconWrap.classList.add("fish-icon-host--ready");
      var fbR = document.createElement("span");
      fbR.className = "fish-icon-fallback fish-icon-fallback--reward";
      fbR.textContent = "\uD83D\uDC1F";
      fbR.setAttribute("role", "img");
      fbR.setAttribute("aria-label", "Рыба");
      iconWrap.appendChild(fbR);
    }

    var amt = document.createElement("span");
    amt.className = "reward-popup__amount";
    amt.textContent = "+" + amountFormatted + " ₸";

    inner.appendChild(iconWrap);
    inner.appendChild(amt);
    el.appendChild(inner);

    els.rewardPopupLayer.classList.add("reward-popup-layer--show");
    els.rewardPopupLayer.setAttribute("aria-hidden", "false");
    els.rewardPopupLayer.appendChild(el);

    function syncLayerAria() {
      if (!els.rewardPopupLayer.children.length) {
        els.rewardPopupLayer.classList.remove("reward-popup-layer--show");
        els.rewardPopupLayer.setAttribute("aria-hidden", "true");
      }
    }

    function onFlyEnd(ev) {
      if (!ev || ev.target !== el) return;
      if (ev.animationName !== "rewardFlyOuter") return;
      el.removeEventListener("animationend", onFlyEnd);
      if (el.parentNode === els.rewardPopupLayer) els.rewardPopupLayer.removeChild(el);
      syncLayerAria();
    }
    el.addEventListener("animationend", onFlyEnd);

    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        el.classList.add("reward-fly");
        inner.classList.add("reward-fly-inner");
        if (kind === "cashout") el.classList.add("reward-fly--cashout");
      });
    });
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
      var fightSecEv = reelWallStartMs ? (Date.now() - reelWallStartMs) / 1000 : 0;
      var evPulse =
        Math.sin(Date.now() / 440 + resistanceVisualSeed) *
        Math.cos(fightSecEv * 0.62 + resistanceVisualSeed * 1.4);
      if (fightSecEv > 1.6 && evPulse > 0.87) {
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

  /** Показ множителя автокэшаута с шагом 0.1 (отдельно от HUD боя). */
  function formatMultAuto(x) {
    return "×" + x.toFixed(1);
  }

  /** Ограничение цели автокэшаута: шаг 0.1, без связи с crashPoint в UI. */
  function clampAutoCashoutValue() {
    autoCashoutValue = Math.round(Math.min(CRASH_MULT_CAP, Math.max(1.05, autoCashoutValue)) * 10) / 10;
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
    syncBetPresetUI();
  }

  function syncBetPresetUI() {
    if (!els.betPresets) return;
    els.betPresets.querySelectorAll(".btn-bet-preset").forEach(function (btn) {
      var raw = btn.getAttribute("data-bet");
      var v = raw ? parseInt(raw, 10) : NaN;
      btn.classList.toggle("is-active", !isNaN(v) && v === bet);
    });
  }

  /**
   * Исход заброса после casting: 40% пусто, 20% малёк, 40% рыба (вид — только через pickFish()).
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
    if (phase === "casting") body.classList.add("is-casting");
    if (phase === "bite") body.classList.add("is-bite");
    if (phase === "reeling") {
      body.classList.add("is-reeling");
      var fsb = reelWallStartMs ? (Date.now() - reelWallStartMs) / 1000 : 0;
      var stutter =
        Math.sin(Date.now() / 410 + resistanceVisualSeed) *
        Math.cos(fsb * 0.58 + resistanceVisualSeed * 1.2);
      if (fsb > 1.7 && stutter > 0.88) body.classList.add("is-intense");
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
          "Малёк. Возврат " + formatMoney(currentWin()) + " ₸";
        break;
      case "bite":
        els.statusText.textContent = "";
        break;
      case "reeling":
        els.statusText.textContent = "";
        break;
      case "cashedOut":
        els.statusText.textContent = "";
        break;
      case "snapped":
        els.statusText.textContent = "";
        break;
      default:
        break;
    }
  }

  /** Линия рыбы на HUD: перенесено в fight-chart (иконка/сумма там же). */
  function syncFishLine() {
    if (!els.fishLine) return;
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
      var sagAmp = phaseKey === "idle" ? 0.35 : 0.55;
      var sagPeriod = phaseKey === "idle" ? 2400 : 1500;
      const sag = 69 + Math.sin(Date.now() / sagPeriod) * sagAmp;
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

  /** Старый блок полоски скрыт; телеметрия сопротивления остаётся для логики и графика. */
  function syncResistanceHudVisibility() {
    if (!els.resistanceHud) return;
    els.resistanceHud.classList.remove("resistance-hud--visible");
    els.resistanceHud.setAttribute("aria-hidden", "true");
  }

  function syncFightChartHint() {
    if (!els.fightChartHint) return;
    if (phase === "bite") {
      els.fightChartHint.textContent = "На крючке";
      return;
    }
    if (phase === "reeling") {
      var fsHint = reelWallStartMs ? (Date.now() - reelWallStartMs) / 1000 : 0;
      if (fsHint < 5) els.fightChartHint.textContent = "Тяни дальше";
      else if (fsHint < 14) els.fightChartHint.textContent = "Рыба сопротивляется";
      else els.fightChartHint.textContent = "Вываживание…";
      return;
    }
    if (phase === "cashedOut") {
      els.fightChartHint.textContent = "В садке!";
      return;
    }
    if (phase === "snapped") {
      els.fightChartHint.textContent = "Обрыв!";
      return;
    }
    els.fightChartHint.innerHTML = "&nbsp;";
  }

  function updateFightChart() {
    if (!els.fightChart || !els.fightChartCurve || !els.fightChartArea || !els.fightChartDot || !currentFish) {
      return;
    }
    var chartPhase =
      phase === "bite" ||
      phase === "reeling" ||
      phase === "cashedOut" ||
      phase === "snapped";
    if (!chartPhase) return;

    els.fightChart.classList.toggle("fight-chart--won", phase === "cashedOut");
    els.fightChart.classList.toggle("fight-chart--lost", phase === "snapped");

    var sm = currentFish.startMultiplier;
    /** Вертикаль: множитель vs косметический диапазон по виду рыбы (не crashPoint). */
    var chartDenomByFish = {
      crucian: 6.2,
      perch: 6.45,
      pike: 6.75,
      catfish: 7.05,
      goldfish: 7.35,
    };
    var visSpan = Math.max(sm * (chartDenomByFish[currentFish.id] || 6.5), 2.85);

    var elapsedFightSec = reelWallStartMs ? (Date.now() - reelWallStartMs) / 1000 : 0;
    var prog;
    var elapsedVisual;

    if (phase === "bite") {
      prog =
        0.055 +
        Math.sin(Date.now() / 920 + resistanceVisualSeed * 1.1) * 0.018 +
        Math.sin(Date.now() / 1400) * 0.008;
      elapsedVisual = 0;
    } else if (phase === "reeling") {
      var tau = 19 + sm * 1.22;
      prog = Math.min(0.97, 1 - Math.exp(-elapsedFightSec / tau));
      fightChartSweepFrozen = prog;
      fightChartFightElapsedFrozen = elapsedFightSec;
      elapsedVisual = elapsedFightSec;
    } else {
      prog = fightChartSweepFrozen;
      elapsedVisual = fightChartFightElapsedFrozen;
    }

    var atmBreath =
      0.28 +
      0.38 *
        Math.sin(Date.now() / 540 + resistanceVisualSeed * 0.05 + elapsedVisual * 1.05) *
        Math.cos(elapsedVisual * 0.41 + resistanceVisualSeed * 1.15);
    var fishTone =
      0.2 +
      Math.sin(sm * 1.07 + resistanceVisualSeed) * 0.12 +
      (chartDenomByFish[currentFish.id] ? (chartDenomByFish[currentFish.id] - 6.5) * 0.08 : 0);

    var steps = 40;
    var pts = [];
    var bottom = 34;
    var i;
    var t;
    var x;
    var multAlong;
    var yn;
    var breathe;
    var arch;
    var y;

    for (i = 0; i <= steps; i++) {
      t = i / steps;
      x = t * 100 * prog;
      if (prog < 0.012 && i > 3) break;
      multAlong = sm + t * (currentMultiplier - sm);
      yn = Math.min(1, Math.max(0, (multAlong - sm) / visSpan));
      breathe =
        Math.sin(Date.now() / 470 + t * 6 + resistanceVisualSeed * 0.02) * 0.42 * atmBreath;
      arch = Math.sin(t * Math.PI) * (1.05 + fishTone + atmBreath * 0.55);
      y = bottom - yn * 24 - arch + breathe;
      pts.push({ x: x, y: y });
    }

    if (pts.length < 2) {
      pts = [
        { x: 0, y: bottom - 0.8 },
        { x: Math.max(2.5, 100 * prog * 0.08), y: bottom - 1.2 },
      ];
    }

    function smoothChartPts(raw) {
      if (raw.length < 3) return raw;
      var out = [];
      var j;
      out.push(raw[0]);
      for (j = 1; j < raw.length - 1; j++) {
        out.push({
          x: raw[j].x,
          y: (raw[j - 1].y + raw[j].y * 2 + raw[j + 1].y) / 4,
        });
      }
      out.push(raw[raw.length - 1]);
      return out;
    }

    pts = smoothChartPts(pts);

    var lineD = pts
      .map(function (p, ii) {
        return (ii === 0 ? "M " : " L ") + p.x.toFixed(2) + " " + p.y.toFixed(2);
      })
      .join("");

    var last = pts[pts.length - 1];
    var fillD =
      lineD +
      " L " +
      last.x.toFixed(2) +
      " " +
      bottom +
      " L 0 " +
      bottom +
      " Z";

    els.fightChartCurve.setAttribute("d", lineD);
    els.fightChartArea.setAttribute("d", fillD);
    els.fightChartDot.setAttribute("cx", last.x.toFixed(2));
    els.fightChartDot.setAttribute("cy", last.y.toFixed(2));
  }

  function renderRoundVisuals() {
    const reeling = phase === "reeling";
    const bite = phase === "bite";
    const fightHud = reeling || bite;
    /** Показ × и суммы: только клёв / вываживание / финал раунда */
    const showFightValues =
      bite || reeling || phase === "cashedOut" || phase === "snapped";
    const showFightChart = showFightValues;

    if (els.hudIdleStack) {
      els.hudIdleStack.classList.toggle("hud-idle-stack--hidden", !!showFightChart);
    }
    if (els.fightChart) {
      els.fightChart.classList.toggle("fight-chart--hidden", !showFightChart);
      els.fightChart.setAttribute("aria-hidden", showFightChart ? "false" : "true");
      if (!showFightChart) {
        els.fightChart.classList.remove("fight-chart--won", "fight-chart--lost");
      }
    }

    if (els.hudCenter) els.hudCenter.classList.toggle("hud-center--fight", fightHud);

    els.multDisplay.textContent = formatMult(currentMultiplier);
    if (phase === "noCatch") {
      els.multDisplay.textContent = formatMult(1);
    }

    els.multDisplay.classList.toggle(
      "dim",
      !(bite || reeling || phase === "cashedOut" || phase === "snapped")
    );

    if (fightHud || phase === "smallCatch") {
      els.catchDisplay.textContent = formatMoney(currentWin()) + " ₸";
    } else if (phase === "noCatch") {
      els.catchDisplay.textContent = "0 ₸";
    } else if (phase === "cashedOut") {
      els.catchDisplay.textContent = formatMoney(currentWin()) + " ₸";
    } else if (
      phase === "idle" ||
      phase === "casting" ||
      phase === "snapped"
    ) {
      els.catchDisplay.textContent = "0 ₸";
    }

    els.catchDisplay.classList.toggle("dim", !(bite || reeling || phase === "cashedOut"));

    if (els.multDisplay) {
      els.multDisplay.classList.toggle("hud-value--hidden", !showFightValues);
      els.multDisplay.setAttribute("aria-hidden", showFightValues ? "false" : "true");
    }
    if (els.catchDisplay) {
      els.catchDisplay.classList.toggle("hud-value--hidden", !showFightValues);
      els.catchDisplay.setAttribute("aria-hidden", showFightValues ? "false" : "true");
    }
    if (els.fishLine) {
      els.fishLine.classList.add("hud-value--hidden");
      els.fishLine.setAttribute("aria-hidden", "true");
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

    syncStatusText();
    syncFishLine();
    updateFightChart();
    syncFightChartHint();

    syncBodyClasses();
    syncEventFeedback();
    syncResistanceHudVisibility();
  }

  function flash(el, ms) {
    if (!el) return;
    el.classList.add("show");
    window.setTimeout(function () {
      el.classList.remove("show");
    }, ms);
  }

  /** Всплеск на воде + «КЛЁВ!» только при outcome fish → фаза bite (вызывается один раз). */
  function triggerBiteSplashEffects() {
    document.body.classList.remove("bite-shake");
    void document.body.offsetWidth;
    document.body.classList.add("bite-shake");
    window.setTimeout(function () {
      document.body.classList.remove("bite-shake");
    }, BITE_SCREEN_SHAKE_MS);

    if (els.biteSceneFlash) {
      els.biteSceneFlash.classList.remove("bite-scene-flash--anim");
      void els.biteSceneFlash.offsetWidth;
      els.biteSceneFlash.classList.add("bite-scene-flash--anim");
      els.biteSceneFlash.setAttribute("aria-hidden", "false");
      window.setTimeout(function () {
        if (!els.biteSceneFlash) return;
        els.biteSceneFlash.classList.remove("bite-scene-flash--anim");
        els.biteSceneFlash.setAttribute("aria-hidden", "true");
      }, BITE_SCENE_FLASH_MS);
    }

    if (els.biteSplash) {
      els.biteSplash.classList.remove("bite-splash--anim");
      void els.biteSplash.offsetWidth;
      els.biteSplash.classList.add("bite-splash--anim");
      els.biteSplash.setAttribute("aria-hidden", "false");
      window.setTimeout(function () {
        if (!els.biteSplash) return;
        els.biteSplash.classList.remove("bite-splash--anim");
        els.biteSplash.setAttribute("aria-hidden", "true");
      }, BITE_SPLASH_ANIM_MS + 90);
    }
    if (els.biteCallout) {
      els.biteCallout.classList.remove("bite-callout--burst");
      void els.biteCallout.offsetWidth;
      els.biteCallout.classList.add("bite-callout--burst");
      els.biteCallout.setAttribute("aria-hidden", "false");
      window.setTimeout(function () {
        if (!els.biteCallout) return;
        els.biteCallout.classList.remove("bite-callout--burst");
        els.biteCallout.setAttribute("aria-hidden", "true");
      }, BITE_CALLOUT_BURST_MS + 60);
    }
  }

  function trimHistoryRealRowsToCap() {
    if (!els.historyList) return;
    while (true) {
      var reals = els.historyList.querySelectorAll(".hist-item:not(.hist-item--placeholder)");
      if (reals.length <= HISTORY_CAP) break;
      reals[reals.length - 1].remove();
    }
  }

  /** Дополняет список до HISTORY_CAP визуальных слотов. */
  function syncHistoryPlaceholders() {
    if (!els.historyList) return;
    els.historyList.querySelectorAll(".hist-item--placeholder").forEach(function (n) {
      n.remove();
    });
    var count = els.historyList.querySelectorAll(".hist-item:not(.hist-item--placeholder)").length;
    var need = Math.max(0, HISTORY_CAP - count);
    for (var pi = 0; pi < need; pi++) {
      var ph = document.createElement("div");
      ph.className = "hist-item hist-item--placeholder";
      ph.setAttribute("aria-hidden", "true");
      var mkG = document.createElement("span");
      mkG.className = "hist-item__marker hist-item__marker--ghost";
      ph.appendChild(mkG);
      var mainPh = document.createElement("span");
      mainPh.className = "hist-item__main";
      var linePh = document.createElement("span");
      linePh.className = "hist-item__placeholder-line";
      mainPh.appendChild(linePh);
      ph.appendChild(mainPh);
      els.historyList.appendChild(ph);
    }
  }

  /** История: последние 8 записей, новые сверху. parts: { label, mult?, amount? }; fishId — из fishTypes или "malek". */
  function pushHistory(parts, className, fishId) {
    if (!els.historyList) return;
    els.historyList.querySelectorAll(".hist-item--placeholder").forEach(function (n) {
      n.remove();
    });

    const row = document.createElement("div");
    row.className = "hist-item " + className;
    var srcHist = fishId && fishIconSrc(fishId);
    if (fishId && GAME_ID_TO_IMAGE_KEY[fishId]) {
      var wrapH = document.createElement("span");
      wrapH.className = "hist-item__fish-wrap";
      wrapH.setAttribute("data-fish-game-id", fishId);
      if (srcHist) {
        var skH = document.createElement("span");
        skH.className = "fish-icon-skeleton fish-icon-skeleton--hist";
        skH.setAttribute("aria-hidden", "true");
        var imgH = document.createElement("img");
        imgH.className = "fish-icon fish-icon--hist";
        imgH.setAttribute("data-fish-game-id", fishId);
        imgH.alt = "Рыба";
        imgH.decoding = "async";
        imgH.loading = "eager";
        bindFishImgLoaded(imgH);
        attachFishIconErrorFallback(imgH, "hist", "Рыба");
        imgH.src = srcHist;
        wrapH.appendChild(skH);
        wrapH.appendChild(imgH);
      } else {
        var hKey = GAME_ID_TO_IMAGE_KEY[fishId];
        console.warn("[fish icon] history: no cleaned asset for", fishId, hKey ? fishImages[hKey] : "");
        wrapH.classList.add("fish-icon-host--ready");
        var fbH = document.createElement("span");
        fbH.className = "fish-icon-fallback fish-icon-fallback--hist";
        fbH.textContent = "\uD83D\uDC1F";
        fbH.setAttribute("role", "img");
        fbH.setAttribute("aria-label", "Рыба");
        wrapH.appendChild(fbH);
      }
      row.appendChild(wrapH);
    } else if (className === "hist-empty") {
      var mkEmpty = document.createElement("span");
      mkEmpty.className = "hist-item__marker hist-item__marker--empty";
      mkEmpty.setAttribute("aria-hidden", "true");
      mkEmpty.setAttribute("title", "Пусто");
      row.appendChild(mkEmpty);
    } else if (className === "hist-snap") {
      var mkSnap = document.createElement("span");
      mkSnap.className = "hist-item__marker hist-item__marker--snap";
      mkSnap.setAttribute("aria-hidden", "true");
      mkSnap.setAttribute("title", "Обрыв");
      row.appendChild(mkSnap);
    }

    var mainSpan = document.createElement("span");
    mainSpan.className = "hist-item__main";
    var lbEl = document.createElement("span");
    lbEl.className = "hist-item__label";
    lbEl.textContent = parts.label || "";
    mainSpan.appendChild(lbEl);
    if (parts.mult) {
      var multEl = document.createElement("span");
      multEl.className = "hist-item__mult";
      multEl.textContent = parts.mult;
      mainSpan.appendChild(multEl);
    }
    if (parts.amount) {
      var amtEl = document.createElement("span");
      amtEl.className = "hist-item__amount";
      amtEl.textContent = parts.amount;
      mainSpan.appendChild(amtEl);
    }
    row.appendChild(mainSpan);

    els.historyList.prepend(row);
    trimHistoryRealRowsToCap();
    syncHistoryPlaceholders();
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
    if (els.betPresets) {
      var bp = els.betPresets.querySelectorAll(".btn-bet-preset");
      for (var bi = 0; bi < bp.length; bi++) {
        bp[bi].disabled = !idle;
      }
    }

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
    clampAutoCashoutValue();
    els.autoCashoutToggle.setAttribute("aria-pressed", autoCashoutEnabled ? "true" : "false");
    els.autoCashoutState.textContent = autoCashoutEnabled ? "ON" : "OFF";
    els.autoCashoutMult.textContent = formatMultAuto(autoCashoutValue);

    var idle = phase === "idle";
    if (els.autoMultMinus) els.autoMultMinus.disabled = !idle;
    if (els.autoMultPlus) els.autoMultPlus.disabled = !idle;

    var presetBtns = els.autoPresets.querySelectorAll(".btn-preset");
    for (var i = 0; i < presetBtns.length; i++) {
      var btn = presetBtns[i];
      var raw = btn.getAttribute("data-mult");
      var v = raw ? parseFloat(raw) : NaN;
      btn.disabled = !idle;
      btn.classList.toggle("is-active", !isNaN(v) && Math.abs(v - autoCashoutValue) < 0.051);
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
    fightChartSweepFrozen = 0.06;
    fightChartFightElapsedFrozen = 0;

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
    document.body.classList.remove("bite-shake");
    clearEventBodyClasses();
    if (els.biteCallout) {
      els.biteCallout.classList.remove("bite-callout--show", "bite-callout--burst");
      els.biteCallout.setAttribute("aria-hidden", "true");
    }
    if (els.biteSceneFlash) {
      els.biteSceneFlash.classList.remove("bite-scene-flash--anim");
      els.biteSceneFlash.setAttribute("aria-hidden", "true");
    }
    if (els.biteSplash) {
      els.biteSplash.classList.remove("bite-splash--anim");
      els.biteSplash.setAttribute("aria-hidden", "true");
    }
    if (els.resistanceHud) {
      els.resistanceHud.classList.remove("resistance-hud--visible");
      els.resistanceHud.setAttribute("aria-hidden", "true");
    }

    clampBet();
    refreshMoneyUI();
    syncButtons();
    syncStatusText();
    syncFishLine();
    updateFishingLine(0, "idle");
    renderRoundVisuals();
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
    if (els.fishSilhouette) els.fishSilhouette.classList.remove("visible");
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
    pushHistory({ label: "Обрыв", mult: "×" + snapMult.toFixed(2) }, "hist-snap");

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
    if (els.fishSilhouette) els.fishSilhouette.classList.remove("visible");
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

    const name = currentFish && currentFish.name ? currentFish.name : "Улов";
    pushHistory(
      {
        label: name,
        mult: "×" + mult.toFixed(2),
        amount: "+" + formatMoney(payout) + " ₸",
      },
      histClassWin(mult),
      currentFish ? currentFish.id : undefined
    );

    showRewardPopup("cashout", formatMoney(payout), currentFish ? currentFish.id : undefined);

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
        pushHistory({ label: "Пусто", amount: "−" + formatMoney(betLocked) + " ₸" }, "hist-empty");
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
          {
            label: "Малёк",
            mult: "×" + currentMultiplier.toFixed(2),
            amount: "+" + formatMoney(smallWin) + " ₸",
          },
          "hist-small",
          "malek"
        );
        refreshMoneyUI();
        syncButtons();
        syncStatusText();
        syncFishLine();
        renderRoundVisuals();
        showRewardPopup("small", formatMoney(smallWin));
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
      triggerBiteSplashEffects();
      if (els.fishSilhouette) els.fishSilhouette.classList.add("visible");

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
      autoCashoutValue = Math.round(v * 10) / 10;
      clampAutoCashoutValue();
      syncAutoCashoutUI();
    });
  }

  if (els.autoMultMinus) {
    els.autoMultMinus.addEventListener("click", function () {
      if (phase !== "idle") return;
      autoCashoutValue -= 0.1;
      clampAutoCashoutValue();
      syncAutoCashoutUI();
    });
  }

  if (els.autoMultPlus) {
    els.autoMultPlus.addEventListener("click", function () {
      if (phase !== "idle") return;
      autoCashoutValue += 0.1;
      clampAutoCashoutValue();
      syncAutoCashoutUI();
    });
  }

  if (els.betPresets) {
    els.betPresets.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".btn-bet-preset");
      if (!btn || phase !== "idle") return;
      var raw = btn.getAttribute("data-bet");
      var v = raw ? parseInt(raw, 10) : NaN;
      if (isNaN(v)) return;
      bet = v;
      clampBet();
      refreshMoneyUI();
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

  preloadFishImages()
    .then(function () {
      return buildCleanedFishImages();
    })
    .finally(function () {
      initFishPanelIcons();
      refreshHistoryFishIcons();
      syncHistoryPlaceholders();
      renderRoundVisuals();
    });

  clampBet();
  refreshMoneyUI();
  syncHistoryLayout();
  syncHistoryPlaceholders();
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
