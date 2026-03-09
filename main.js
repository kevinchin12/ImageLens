const GAME_DURATION = 60_000;
const STORAGE_KEYS = {
  leaderboard: "zen-mokugyo-leaderboard",
  achievements: "zen-mokugyo-achievements",
  easter: "zen-mokugyo-night-mode",
};

const DIFFICULTIES = [
  {
    id: "easy",
    label: "初心",
    bpm: 48,
    hitWindow: 220,
    perfectWindow: 45,
    description: "节奏宽松，适合找呼吸。",
  },
  {
    id: "normal",
    label: "入定",
    bpm: 60,
    hitWindow: 160,
    perfectWindow: 32,
    description: "一呼一击，重视稳定感。",
  },
  {
    id: "hard",
    label: "空明",
    bpm: 72,
    hitWindow: 120,
    perfectWindow: 24,
    description: "间隔更短，要求心手合一。",
  },
];

const ACHIEVEMENT_DEFS = [
  {
    id: "first-breath",
    name: "第一息",
    description: "完成一局修行。",
    test: (stats) => stats.finishedRuns >= 1,
  },
  {
    id: "perfect-five",
    name: "静如止水",
    description: "单局完成 5 次 Perfect。",
    test: (stats) => stats.maxPerfects >= 5,
  },
  {
    id: "combo-ten",
    name: "木鱼连珠",
    description: "单局达成 10 连击。",
    test: (stats) => stats.maxCombo >= 10,
  },
  {
    id: "high-score",
    name: "禅院首席",
    description: "任意难度达到 800 分。",
    test: (stats) => stats.highScore >= 800,
  },
  {
    id: "moon-mode",
    name: "月下禅心",
    description: "触发夜间禅境彩蛋。",
    test: (stats) => stats.nightModeUnlocked,
  },
];

const state = {
  difficulty: DIFFICULTIES[1],
  audioCtx: null,
  muted: false,
  running: false,
  countdownActive: false,
  startTime: 0,
  countdownTimer: null,
  raf: null,
  runId: 0,
  beatTimes: [],
  beatTimeouts: [],
  clickedBeats: new Set(),
  score: 0,
  combo: 0,
  bestOffset: Infinity,
  perfectHits: 0,
  stats: loadStats(),
  lanternPresses: 0,
  lastSummary: "",
  pendingResult: null,
};

const els = {
  difficultyList: document.getElementById("difficultyList"),
  countdown: document.getElementById("countdown"),
  timeLeft: document.getElementById("timeLeft"),
  score: document.getElementById("score"),
  combo: document.getElementById("combo"),
  bestOffset: document.getElementById("bestOffset"),
  achievementHint: document.getElementById("achievementHint"),
  feedback: document.getElementById("feedback"),
  startButton: document.getElementById("startButton"),
  shareButton: document.getElementById("shareButton"),
  mokugyo: document.getElementById("mokugyo"),
  stage: document.querySelector(".stage"),
  pulseRing: document.querySelector(".pulse-ring"),
  ambientMessage: document.getElementById("ambientMessage"),
  leaderboard: document.getElementById("leaderboard"),
  achievements: document.getElementById("achievements"),
  easterEggTrigger: document.getElementById("easterEggTrigger"),
  muteToggle: document.getElementById("muteToggle"),
  resultModal: document.getElementById("resultModal"),
  resultSummary: document.getElementById("resultSummary"),
  playerName: document.getElementById("playerName"),
  saveScoreButton: document.getElementById("saveScoreButton"),
  skipScoreButton: document.getElementById("skipScoreButton"),
};

init();

function init() {
  renderDifficultyButtons();
  renderLeaderboard();
  renderAchievements();
  applyNightMode(Boolean(localStorage.getItem(STORAGE_KEYS.easter)));

  els.startButton.addEventListener("click", startGame);
  els.shareButton.addEventListener("click", shareResult);
  els.mokugyo.addEventListener("click", registerHit);
  els.easterEggTrigger.addEventListener("click", triggerLantern);
  els.muteToggle.addEventListener("click", toggleMute);
  els.saveScoreButton.addEventListener("click", saveScoreWithName);
  els.skipScoreButton.addEventListener("click", closeResultModal);
  els.playerName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      saveScoreWithName();
    }
  });
  updateHud();
}

function renderDifficultyButtons() {
  els.difficultyList.innerHTML = "";
  DIFFICULTIES.forEach((difficulty) => {
    const button = document.createElement("button");
    button.className = `difficulty-button${difficulty.id === state.difficulty.id ? " active" : ""}`;
    button.textContent = `${difficulty.label} ${difficulty.bpm} BPM`;
    button.title = difficulty.description;
    button.addEventListener("click", () => {
      if (state.running || state.countdownActive) return;
      state.difficulty = difficulty;
      renderDifficultyButtons();
      els.feedback.textContent = difficulty.description;
      els.ambientMessage.textContent = `即将进入 ${difficulty.label}`;
    });
    els.difficultyList.appendChild(button);
  });
}

async function startGame() {
  if (state.running || state.countdownActive) return;

  closeResultModal({ preserveFeedback: true });
  ensureAudio();
  if (state.audioCtx?.state === "suspended") {
    await state.audioCtx.resume();
  }

  resetRunState();
  state.countdownActive = true;
  els.startButton.textContent = "入定中";
  els.feedback.textContent = `听住 ${state.difficulty.bpm} BPM 的引导节拍。`;
  els.ambientMessage.textContent = "呼吸 · 倒数开始";

  let count = 3;
  els.countdown.textContent = String(count);
  playCountdownTone(580);

  state.countdownTimer = setInterval(() => {
    count -= 1;
    if (count > 0) {
      els.countdown.textContent = String(count);
      playCountdownTone(580 - (3 - count) * 70);
      return;
    }

    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
    state.countdownActive = false;
    beginRun();
  }, 1000);
}

function beginRun() {
  state.runId += 1;
  state.running = true;
  state.startTime = performance.now();
  state.beatTimes = buildBeatTimeline(state.startTime, state.difficulty.bpm, GAME_DURATION);
  els.countdown.textContent = "开始";
  els.ambientMessage.textContent = "听音落击";
  scheduleBeats();
  tick();
}

function buildBeatTimeline(startAt, bpm, duration) {
  const interval = 60_000 / bpm;
  const beats = [];
  for (let offset = 0; offset <= duration + interval; offset += interval) {
    beats.push(startAt + offset);
  }
  return beats;
}

function scheduleBeats() {
  const currentRunId = state.runId;
  state.beatTimes.forEach((time, index) => {
    const delay = Math.max(time - state.startTime, 0);
    const timeoutId = window.setTimeout(() => {
      if (!state.running || state.muted || currentRunId !== state.runId) return;
      playBeatTone(index);
      pulseStage();
    }, delay);
    state.beatTimeouts.push(timeoutId);
  });
}

function tick() {
  if (!state.running) return;
  const elapsed = performance.now() - state.startTime;
  const left = Math.max(0, GAME_DURATION - elapsed);
  els.timeLeft.textContent = (left / 1000).toFixed(1);

  if (left <= 0) {
    finishRun();
    return;
  }

  state.raf = requestAnimationFrame(tick);
}

function registerHit() {
  animateHit();

  if (!state.running) {
    els.feedback.textContent = "先开始一局，再跟随节拍轻敲。";
    if (!state.muted) {
      playClickTone(0.08, 180);
    }
    return;
  }

  const now = performance.now();
  let nearestIndex = -1;
  let nearestDelta = Infinity;

  state.beatTimes.forEach((beat, index) => {
    if (state.clickedBeats.has(index)) return;
    const delta = Math.abs(now - beat);
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  });

  if (nearestIndex === -1) return;

  state.clickedBeats.add(nearestIndex);
  const ms = Math.round(nearestDelta);
  state.bestOffset = Math.min(state.bestOffset, ms);

  let gainScore = 0;
  let label = "偏了";

  if (nearestDelta <= state.difficulty.perfectWindow) {
    gainScore = 120;
    state.combo += 1;
    state.perfectHits += 1;
    label = "Perfect";
  } else if (nearestDelta <= state.difficulty.hitWindow * 0.45) {
    gainScore = 80;
    state.combo += 1;
    label = "Great";
  } else if (nearestDelta <= state.difficulty.hitWindow) {
    gainScore = 35;
    state.combo = Math.max(0, state.combo - 1);
    label = "Good";
  } else {
    gainScore = -60;
    state.combo = 0;
    label = "Miss";
  }

  if (nearestDelta > state.difficulty.hitWindow) {
    els.feedback.textContent = `Miss，偏差 ${ms}ms，先听稳节拍。`;
    playJudgementTone("bad");
  } else {
    const comboBonus = state.combo >= 2 ? Math.min(60, state.combo * 4) : 0;
    gainScore += comboBonus;
    els.feedback.textContent = `${label}，偏差 ${ms}ms，连击加成 +${comboBonus}`;
    playJudgementTone(label === "Perfect" ? "perfect" : "good");
  }

  state.score += gainScore;
  state.stats.maxCombo = Math.max(state.stats.maxCombo, state.combo);
  state.stats.maxPerfects = Math.max(state.stats.maxPerfects, state.perfectHits);
  updateHud();
}

function finishRun() {
  state.running = false;
  cancelAnimationFrame(state.raf);
  state.raf = null;
  clearBeatTimeouts();
  els.timeLeft.textContent = "0.0";
  els.countdown.textContent = "结束";
  els.startButton.textContent = "再来一局";

  const entry = {
    score: state.score,
    difficulty: state.difficulty.label,
    bpm: state.difficulty.bpm,
    date: formatDate(new Date()),
    player: "",
  };

  state.stats.finishedRuns += 1;
  state.stats.highScore = Math.max(state.stats.highScore, state.score);
  saveStats();
  unlockAchievements();

  const bestOffsetText = Number.isFinite(state.bestOffset) ? `${state.bestOffset}ms` : "-";
  state.lastSummary = `我在禅击木鱼 ${state.difficulty.label} 难度拿到 ${state.score} 分，最佳误差 ${bestOffsetText}，来听节拍挑战吧。`;
  els.feedback.textContent = `本局结束：${state.score} 分，最佳误差 ${bestOffsetText}。`;
  els.ambientMessage.textContent = state.score >= 800 ? "心手合一" : "余音未散";
  state.pendingResult = entry;
  openResultModal(bestOffsetText);
  updateHud();
}

function updateHud() {
  els.score.textContent = String(state.score);
  els.combo.textContent = String(state.combo);
  els.bestOffset.textContent = Number.isFinite(state.bestOffset) ? `${state.bestOffset}ms` : "-";
  const unlocked = getUnlockedAchievements();
  els.achievementHint.textContent = `${unlocked.length}/${ACHIEVEMENT_DEFS.length}`;
  els.stage.classList.toggle("high-score", state.score >= 800);
  renderAchievements();
}

function resetRunState() {
  clearBeatTimeouts();
  state.score = 0;
  state.combo = 0;
  state.bestOffset = Infinity;
  state.perfectHits = 0;
  state.clickedBeats = new Set();
  els.timeLeft.textContent = "60.0";
  updateHud();
}

function persistLeaderboard(entry) {
  const current = loadLeaderboard();
  current.push(entry);
  current.sort((a, b) => b.score - a.score);
  localStorage.setItem(STORAGE_KEYS.leaderboard, JSON.stringify(current.slice(0, 8)));
}

function renderLeaderboard() {
  const board = loadLeaderboard();
  els.leaderboard.innerHTML = "";

  if (!board.length) {
    const li = document.createElement("li");
    li.innerHTML = "<span>暂无修行记录</span><span>等待第一位玩家</span>";
    els.leaderboard.appendChild(li);
    return;
  }

  board.forEach((entry, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>#${index + 1} ${entry.player || "无名修行者"} · ${entry.difficulty}</span><span>${entry.score} 分 · ${entry.date}</span>`;
    els.leaderboard.appendChild(li);
  });
}

function renderAchievements() {
  const unlocked = new Set(getUnlockedAchievements());
  els.achievements.innerHTML = "";

  ACHIEVEMENT_DEFS.forEach((achievement) => {
    const li = document.createElement("li");
    const isUnlocked = unlocked.has(achievement.id);
    li.className = isUnlocked ? "" : "locked";
    li.innerHTML = `<span>${achievement.name}</span><span>${isUnlocked ? "已解锁" : achievement.description}</span>`;
    els.achievements.appendChild(li);
  });
}

function unlockAchievements() {
  const unlocked = new Set(getUnlockedAchievements());

  ACHIEVEMENT_DEFS.forEach((achievement) => {
    if (achievement.test(state.stats)) {
      unlocked.add(achievement.id);
    }
  });

  localStorage.setItem(STORAGE_KEYS.achievements, JSON.stringify([...unlocked]));
}

function getUnlockedAchievements() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.achievements) || "[]");
  } catch {
    return [];
  }
}

function loadLeaderboard() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.leaderboard) || "[]");
  } catch {
    return [];
  }
}

function loadStats() {
  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_KEYS.achievements + "-stats") ||
        '{"finishedRuns":0,"maxPerfects":0,"maxCombo":0,"highScore":0,"nightModeUnlocked":false}'
    );
  } catch {
    return {
      finishedRuns: 0,
      maxPerfects: 0,
      maxCombo: 0,
      highScore: 0,
      nightModeUnlocked: false,
    };
  }
}

function saveStats() {
  localStorage.setItem(STORAGE_KEYS.achievements + "-stats", JSON.stringify(state.stats));
}

function shareResult() {
  const text =
    state.lastSummary ||
    `我正在玩禅击木鱼，${state.difficulty.label} 难度 ${state.difficulty.bpm} BPM，来试试你的节拍感。`;

  if (navigator.share) {
    navigator
      .share({
        title: "禅击木鱼",
        text,
      })
      .catch(() => {});
    return;
  }

  navigator.clipboard?.writeText(text).then(() => {
    els.feedback.textContent = "战报已复制，可直接发给朋友。";
  }).catch(() => {
    els.feedback.textContent = text;
  });
}

function triggerLantern() {
  state.lanternPresses += 1;
  if (state.lanternPresses < 5) {
    els.feedback.textContent = `纸灯笼轻晃 ${state.lanternPresses}/5`;
    return;
  }

  state.lanternPresses = 0;
  const night = !document.body.classList.contains("night");
  applyNightMode(night);
  state.stats.nightModeUnlocked = true;
  saveStats();
  unlockAchievements();
  updateHud();
  els.feedback.textContent = night ? "月下禅境已开启。" : "晨光禅境已恢复。";
}

function openResultModal(bestOffsetText) {
  els.resultSummary.textContent = `本局 ${state.score} 分，最佳误差 ${bestOffsetText}。输入名字后保存到排行榜。`;
  els.resultModal.classList.remove("hidden");
  els.resultModal.setAttribute("aria-hidden", "false");
  els.playerName.value = "";
  window.setTimeout(() => els.playerName.focus(), 0);
}

function closeResultModal(options = {}) {
  const { preserveFeedback = false } = options;
  state.pendingResult = null;
  els.resultModal.classList.add("hidden");
  els.resultModal.setAttribute("aria-hidden", "true");
  if (!preserveFeedback) {
    els.feedback.textContent = "本局未入榜，可直接开始下一局。";
  }
}

function saveScoreWithName() {
  if (!state.pendingResult) {
    closeResultModal();
    return;
  }

  const playerName = els.playerName.value.trim();
  if (!playerName) {
    els.feedback.textContent = "输入名字后才能入榜；若不想保存，点匿名跳过。";
    return;
  }

  state.pendingResult.player = playerName;
  persistLeaderboard(state.pendingResult);
  renderLeaderboard();
  els.feedback.textContent = `${playerName} 已写入排行榜。`;
  closeResultModal({ preserveFeedback: true });
}

function applyNightMode(enabled) {
  document.body.classList.toggle("night", enabled);
  if (enabled) {
    localStorage.setItem(STORAGE_KEYS.easter, "1");
  } else {
    localStorage.removeItem(STORAGE_KEYS.easter);
  }
}

function toggleMute() {
  state.muted = !state.muted;
  els.muteToggle.textContent = state.muted ? "音效关" : "音效开";
  els.muteToggle.setAttribute("aria-pressed", String(state.muted));
}

function animateHit() {
  els.mokugyo.classList.remove("hit");
  void els.mokugyo.offsetWidth;
  els.mokugyo.classList.add("hit");
  setTimeout(() => els.mokugyo.classList.remove("hit"), 140);
}

function pulseStage() {
  els.pulseRing.classList.remove("active");
  void els.pulseRing.offsetWidth;
  els.pulseRing.classList.add("active");
}

function clearBeatTimeouts() {
  state.beatTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
  state.beatTimeouts = [];
}

function ensureAudio() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playBeatTone(index) {
  const accent = index % 4 === 0;
  playTone(accent ? 540 : 420, 0.12, accent ? "triangle" : "sine", 0.04);
  playClickTone(0.1, accent ? 210 : 180);
}

function playCountdownTone(frequency) {
  if (state.muted) return;
  playTone(frequency, 0.16, "square", 0.03);
}

function playJudgementTone(type) {
  if (state.muted) return;
  if (type === "perfect") {
    playTone(740, 0.08, "triangle", 0.035);
    window.setTimeout(() => playTone(980, 0.08, "triangle", 0.025), 90);
    return;
  }
  if (type === "good") {
    playTone(620, 0.07, "sine", 0.025);
    return;
  }
  playTone(180, 0.12, "sawtooth", 0.028);
}

function playClickTone(duration, frequency) {
  if (state.muted) return;
  ensureAudio();
  const start = state.audioCtx.currentTime;
  const noise = state.audioCtx.createBufferSource();
  const buffer = state.audioCtx.createBuffer(1, state.audioCtx.sampleRate * duration, state.audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * Math.exp((-6 * i) / data.length);
  }
  noise.buffer = buffer;

  const bandpass = state.audioCtx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = frequency;
  bandpass.Q.value = 1.2;

  const gain = state.audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.16, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  noise.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(state.audioCtx.destination);
  noise.start(start);
  noise.stop(start + duration);
}

function playTone(frequency, duration, type, volume) {
  if (state.muted) return;
  ensureAudio();
  const start = state.audioCtx.currentTime;
  const osc = state.audioCtx.createOscillator();
  const gain = state.audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain);
  gain.connect(state.audioCtx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.01);
}

function formatDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
