const imageCache = new Map();

const state = {
  settings: null,
  hoverImage: null,
  panelImage: null,
  panelData: {
    zhPrompt: "",
    enPrompt: "",
    negativePrompt: "",
    title: "",
    language: "zh"
  },
  panelOpen: false,
  busy: false
};

const hoverTrigger = document.createElement("button");
hoverTrigger.id = "pg-hover-trigger";
hoverTrigger.type = "button";
hoverTrigger.title = "分析图片并生成提示词";

const panel = document.createElement("aside");
panel.id = "pg-panel";
panel.innerHTML = `
  <div class="pg-shell">
    <div class="pg-header">
      <div class="pg-title">
        <strong>Prompt Glass</strong>
        <span id="pg-panel-subtitle">分析网页图片，生成可编辑提示词</span>
      </div>
      <button class="pg-close" id="pg-close" type="button">关闭</button>
    </div>
    <div class="pg-row">
      <div class="pg-preview"><img id="pg-preview-image" alt="selected image preview" /></div>
      <div class="pg-title">
        <strong id="pg-image-title">当前图片</strong>
        <span id="pg-image-url">等待选择图片</span>
      </div>
    </div>
    <div class="pg-editor">
      <div class="pg-row">
        <button class="pg-chip is-active" id="pg-lang-zh" type="button">中文</button>
        <button class="pg-chip" id="pg-lang-en" type="button">English</button>
        <span class="pg-hint" id="pg-language-hint">当前展示中文提示词</span>
      </div>
      <textarea class="pg-textarea" id="pg-prompt-input" placeholder="这里会显示识别后的提示词，你可以直接修改。"></textarea>
      <div class="pg-meta">
        <span id="pg-status">就绪</span>
        <span id="pg-char-count">0 字</span>
      </div>
    </div>
    <div class="pg-actions">
      <button class="pg-action" id="pg-analyze" type="button">重新识别</button>
      <button class="pg-action" id="pg-copy" type="button">复制提示词</button>
      <button class="pg-action primary" id="pg-generate" type="button">立刻生图</button>
    </div>
  </div>
`;

document.documentElement.append(hoverTrigger, panel);

const els = {
  previewImage: panel.querySelector("#pg-preview-image"),
  imageTitle: panel.querySelector("#pg-image-title"),
  imageUrl: panel.querySelector("#pg-image-url"),
  subtitle: panel.querySelector("#pg-panel-subtitle"),
  langZh: panel.querySelector("#pg-lang-zh"),
  langEn: panel.querySelector("#pg-lang-en"),
  languageHint: panel.querySelector("#pg-language-hint"),
  input: panel.querySelector("#pg-prompt-input"),
  status: panel.querySelector("#pg-status"),
  charCount: panel.querySelector("#pg-char-count"),
  analyze: panel.querySelector("#pg-analyze"),
  copy: panel.querySelector("#pg-copy"),
  generate: panel.querySelector("#pg-generate"),
  close: panel.querySelector("#pg-close")
};

init();

async function init() {
  const response = await sendMessage({ type: "get-settings" });
  state.settings = response;
  state.panelData.language = state.settings.defaultLanguage || "zh";
  bindEvents();
}

function bindEvents() {
  document.addEventListener("pointermove", handlePointerMove, true);
  document.addEventListener("scroll", updateHoverButtonPosition, true);
  window.addEventListener("resize", updateHoverButtonPosition);

  hoverTrigger.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!state.hoverImage) return;
    await openPanelForImage(state.hoverImage);
  });

  els.close.addEventListener("click", closePanel);

  els.input.addEventListener("input", () => {
    const key = getLanguageKey();
    state.panelData[key] = els.input.value;
    updateMeta();
    persistPanelImageCache();
  });

  els.langZh.addEventListener("click", () => switchLanguage("zh"));
  els.langEn.addEventListener("click", () => switchLanguage("en"));

  els.analyze.addEventListener("click", () => analyzeCurrentImage({ force: true }));

  els.copy.addEventListener("click", async () => {
    const text = els.input.value.trim();
    if (!text) {
      setStatus("没有可复制的提示词。");
      return;
    }
    await navigator.clipboard.writeText(text);
    setStatus("提示词已复制。");
  });

  els.generate.addEventListener("click", async () => {
    const prompt = getPromptForGeneration();
    if (!prompt) {
      setStatus("请先识别或输入提示词。");
      return;
    }

    await runBusyTask("正在生图...", async () => {
      await sendMessage({
        type: "generate-image",
        payload: {
          prompt,
          aspectRatio: state.settings?.aspectRatio || "1:1",
          count: state.settings?.imageCount || 1
        }
      });
      setStatus("已打开结果页。");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.panelOpen) {
      closePanel();
    }
  });
}

function handlePointerMove(event) {
  if (state.panelOpen && panel.contains(event.target)) return;

  const image = event.target instanceof Element ? findEligibleImage(event.target) : null;

  if (!image) {
    if (!hoverTrigger.matches(":hover")) {
      hideHoverButton();
    }
    return;
  }

  state.hoverImage = image;
  updateHoverButtonPosition();
}

function findEligibleImage(startNode) {
  const image = startNode.closest("img");
  if (!image) return null;
  const rect = image.getBoundingClientRect();
  const src = image.currentSrc || image.src;

  if (!src || rect.width < 96 || rect.height < 96) {
    return null;
  }

  return image;
}

function updateHoverButtonPosition() {
  if (!state.hoverImage || !document.documentElement.contains(state.hoverImage)) {
    hideHoverButton();
    return;
  }

  const rect = state.hoverImage.getBoundingClientRect();
  if (rect.width < 96 || rect.height < 96 || rect.bottom < 0 || rect.top > window.innerHeight) {
    hideHoverButton();
    return;
  }

  hoverTrigger.style.display = "flex";
  hoverTrigger.style.top = `${Math.max(10, rect.top + 8)}px`;
  hoverTrigger.style.left = `${Math.max(10, rect.right - 42)}px`;
}

function hideHoverButton() {
  state.hoverImage = null;
  hoverTrigger.style.display = "none";
}

async function openPanelForImage(image) {
  state.panelImage = image;
  state.panelOpen = true;
  panel.classList.add("pg-open");

  const imageUrl = image.currentSrc || image.src;
  els.previewImage.src = imageUrl;
  els.imageTitle.textContent = image.alt?.trim() || "网页图片";
  els.imageUrl.textContent = truncateMiddle(imageUrl, 52);
  els.subtitle.textContent = "识别结果可直接修改，再复制或立即生图";

  const cached = imageCache.get(imageUrl);
  if (cached) {
    hydratePanelData(cached);
    return;
  }

  clearPanelData();
  if (state.settings?.autoAnalyze) {
    await analyzeCurrentImage({ force: false });
  } else {
    setStatus("已选中图片，点击“重新识别”开始分析。");
  }
}

function closePanel() {
  state.panelOpen = false;
  panel.classList.remove("pg-open");
}

async function analyzeCurrentImage({ force }) {
  if (!state.panelImage) return;

  const imageUrl = state.panelImage.currentSrc || state.panelImage.src;
  if (!imageUrl) return;

  if (!force && imageCache.has(imageUrl)) {
    hydratePanelData(imageCache.get(imageUrl));
    return;
  }

  await runBusyTask("正在识别图片内容...", async () => {
    const result = await sendMessage({
      type: "analyze-image",
      payload: {
        imageUrl,
        pageUrl: location.href,
        alt: state.panelImage.alt || ""
      }
    });

    const cached = {
      zhPrompt: result.zhPrompt || "",
      enPrompt: result.enPrompt || "",
      negativePrompt: result.negativePrompt || "",
      title: result.title || "图片提示词",
      language: state.panelData.language || state.settings?.defaultLanguage || "zh"
    };

    imageCache.set(imageUrl, cached);
    hydratePanelData(cached);
  });
}

async function switchLanguage(language) {
  state.panelData.language = language;
  const key = language === "en" ? "enPrompt" : "zhPrompt";

  if (language === "en" && !state.panelData.enPrompt.trim() && state.panelData.zhPrompt.trim()) {
    await runBusyTask("正在翻译为英文...", async () => {
      const result = await sendMessage({
        type: "translate-prompt",
        payload: {
          text: state.panelData.zhPrompt,
          targetLanguage: "en"
        }
      });
      state.panelData.enPrompt = result.translatedText || "";
      persistPanelImageCache();
    });
  }

  if (language === "zh" && !state.panelData.zhPrompt.trim() && state.panelData.enPrompt.trim()) {
    await runBusyTask("正在翻译为中文...", async () => {
      const result = await sendMessage({
        type: "translate-prompt",
        payload: {
          text: state.panelData.enPrompt,
          targetLanguage: "zh"
        }
      });
      state.panelData.zhPrompt = result.translatedText || "";
      persistPanelImageCache();
    });
  }

  els.langZh.classList.toggle("is-active", language === "zh");
  els.langEn.classList.toggle("is-active", language === "en");
  els.languageHint.textContent = language === "zh" ? "当前展示中文提示词" : "Currently showing the English prompt";
  els.input.value = state.panelData[key] || "";
  updateMeta();
}

function hydratePanelData(data) {
  state.panelData = {
    zhPrompt: data.zhPrompt || "",
    enPrompt: data.enPrompt || "",
    negativePrompt: data.negativePrompt || "",
    title: data.title || "图片提示词",
    language: data.language || state.settings?.defaultLanguage || "zh"
  };

  els.imageTitle.textContent = state.panelData.title || "图片提示词";
  switchLanguage(state.panelData.language);
  setStatus("识别完成，可直接修改。");
}

function clearPanelData() {
  state.panelData = {
    zhPrompt: "",
    enPrompt: "",
    negativePrompt: "",
    title: "",
    language: state.settings?.defaultLanguage || "zh"
  };
  els.input.value = "";
  switchLanguage(state.panelData.language);
  setStatus("等待识别...");
}

function getLanguageKey() {
  return state.panelData.language === "en" ? "enPrompt" : "zhPrompt";
}

function getPromptForGeneration() {
  const current = els.input.value.trim();
  if (state.panelData.language === "en") return current;
  return state.panelData.enPrompt.trim() || current;
}

function persistPanelImageCache() {
  if (!state.panelImage) return;
  const imageUrl = state.panelImage.currentSrc || state.panelImage.src;
  if (!imageUrl) return;
  imageCache.set(imageUrl, { ...state.panelData });
}

function updateMeta() {
  const text = els.input.value || "";
  els.charCount.textContent = `${text.length} 字`;
}

async function runBusyTask(statusText, task) {
  if (state.busy) return;

  state.busy = true;
  panel.classList.add("pg-loading");
  setStatus(statusText);

  try {
    await task();
  } catch (error) {
    setStatus(error.message || "发生错误，请稍后重试。");
  } finally {
    state.busy = false;
    panel.classList.remove("pg-loading");
    updateMeta();
  }
}

function setStatus(text) {
  els.status.textContent = text;
}

function truncateMiddle(text, maxLength) {
  if (text.length <= maxLength) return text;
  const head = Math.ceil(maxLength / 2) - 2;
  const tail = Math.floor(maxLength / 2) - 1;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension request failed.");
  }
  return response.data;
}
