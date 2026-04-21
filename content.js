const imageCache = new Map();
const RATIO_OPTIONS = ["1:1", "3:4", "4:3", "9:16", "16:9"];

const state = {
  settings: null,
  hoverImage: null,
  panelImage: null,
  panelOpen: false,
  currentJob: null,
  panelData: createEmptyPanelData(),
  actionState: {
    analyze: false,
    generate: false
  }
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
        <strong>图透镜 Image Lens</strong>
      </div>
      <div class="pg-header-actions">
        <button class="pg-icon-button" id="pg-open-options" type="button" aria-label="打开设置" title="打开设置">⚙</button>
        <button class="pg-close" id="pg-close" type="button">关闭</button>
      </div>
    </div>

    <div class="pg-row">
      <div class="pg-preview"><img id="pg-preview-image" alt="selected image preview" /></div>
      <div class="pg-title">
        <strong id="pg-image-title">当前图片</strong>
        <span id="pg-image-url">等待选择图片</span>
      </div>
    </div>

    <section class="pg-section pg-section-prompt">
      <div class="pg-section-head">
        <strong>提示词</strong>
        <div class="pg-chip-group">
          <button class="pg-chip is-active" id="pg-detail-short" type="button">精简版</button>
          <button class="pg-chip" id="pg-detail-full" type="button">完整版</button>
          <button class="pg-chip" id="pg-toggle-translation" type="button">翻译</button>
        </div>
      </div>

      <textarea class="pg-textarea" id="pg-prompt-input" placeholder="这里会显示识别后的提示词，你可以直接修改。"></textarea>

      <div class="pg-meta">
        <span id="pg-status">就绪</span>
        <span id="pg-char-count">0 字</span>
      </div>

      <div class="pg-actions pg-actions-fixed">
        <button class="pg-action pg-fixed-control" id="pg-copy" type="button">复制提示词</button>
        <button class="pg-action pg-fixed-control" id="pg-analyze" type="button">重新识别</button>
      </div>
    </section>

    <section class="pg-section">
      <div class="pg-section-head">
        <strong>立刻生图</strong>
      </div>

      <div class="pg-generate-row">
        <label class="pg-select-wrap pg-fixed-control-wrap">
          <span>图片比例</span>
          <select class="pg-select pg-fixed-control" id="pg-ratio-select"></select>
        </label>
        <div class="pg-actions pg-actions-fixed">
          <button class="pg-action primary pg-fixed-control" id="pg-generate" type="button">立刻生图</button>
        </div>
      </div>

      <div class="pg-inline-preview" id="pg-inline-preview">
        <div class="pg-inline-stack" id="pg-inline-grid"></div>
      </div>
    </section>

    <p class="pg-credit">© 2026 嘉文钱. Licensed under MIT</p>
  </div>
`;

document.documentElement.append(hoverTrigger, panel);

const els = {
  previewImage: panel.querySelector("#pg-preview-image"),
  imageTitle: panel.querySelector("#pg-image-title"),
  imageUrl: panel.querySelector("#pg-image-url"),
  input: panel.querySelector("#pg-prompt-input"),
  status: panel.querySelector("#pg-status"),
  charCount: panel.querySelector("#pg-char-count"),
  analyze: panel.querySelector("#pg-analyze"),
  copy: panel.querySelector("#pg-copy"),
  generate: panel.querySelector("#pg-generate"),
  close: panel.querySelector("#pg-close"),
  openOptions: panel.querySelector("#pg-open-options"),
  detailShort: panel.querySelector("#pg-detail-short"),
  detailFull: panel.querySelector("#pg-detail-full"),
  toggleTranslation: panel.querySelector("#pg-toggle-translation"),
  ratioSelect: panel.querySelector("#pg-ratio-select"),
  inlinePreview: panel.querySelector("#pg-inline-preview"),
  inlineGrid: panel.querySelector("#pg-inline-grid")
};

init();

async function init() {
  const response = await sendMessage({ type: "get-settings" });
  state.settings = response;
  state.panelData.detail = "short";
  state.panelData.aspectRatio = state.settings.aspectRatio || "1:1";
  renderRatioSelect();
  bindEvents();
  syncPromptControls();
}

function createEmptyPanelData() {
  return {
    title: "",
    detail: "short",
    language: "zh",
    aspectRatio: "1:1",
    prompts: {
      short: {
        en: "",
        zh: ""
      },
      full: {
        en: "",
        zh: ""
      }
    }
  };
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
  els.openOptions.addEventListener("click", async () => {
    await sendMessage({ type: "open-options" });
  });

  els.input.addEventListener("input", () => {
    state.panelData.prompts[state.panelData.detail][getCurrentLanguage()] = els.input.value;
    updateMeta();
    persistPanelImageCache();
  });

  els.detailShort.addEventListener("click", () => switchDetail("short"));
  els.detailFull.addEventListener("click", () => switchDetail("full"));
  els.toggleTranslation.addEventListener("click", togglePromptLanguage);
  els.analyze.addEventListener("click", () => analyzeCurrentImage({ force: true }));

  els.ratioSelect.addEventListener("change", () => {
    state.panelData.aspectRatio = els.ratioSelect.value;
    persistPanelImageCache();
    setStatus(`生图比例已切换为 ${state.panelData.aspectRatio}`);
  });

  els.copy.addEventListener("click", async () => {
    const text = getCurrentPrompt().trim();
    if (!text) {
      setStatus("没有可复制的提示词。", "error");
      return;
    }
    await navigator.clipboard.writeText(text);
    setStatus("提示词已复制。", "success");
  });

  els.generate.addEventListener("click", () => generateFromCurrentPrompt());
  els.inlineGrid.addEventListener("click", handleInlinePreviewClick);
}

function renderRatioSelect() {
  els.ratioSelect.innerHTML = RATIO_OPTIONS.map((ratio) => {
    const selected = ratio === state.panelData.aspectRatio ? " selected" : "";
    return `<option value="${ratio}"${selected}>${ratio}</option>`;
  }).join("");
}

function handleInlinePreviewClick(event) {
  const action = event.target.closest("[data-role]");
  if (!action) return;

  const role = action.dataset.role;
  const index = Number(action.dataset.index);
  if (!Number.isFinite(index)) return;

  const src = getImageDataUrl(index);
  if (!src) return;

  if (role === "download") {
    triggerDownload(src, `prompt-glass-${index + 1}.png`);
    return;
  }

  if (role === "viewer") {
    sendMessage({ type: "open-viewer" }).catch((error) => {
      setStatus(error.message || "打开新页面失败。", "error");
    });
  }
}

function handlePointerMove(event) {
  if (state.panelOpen && panel.contains(event.target)) return;

  const image = event.target instanceof Element ? findEligibleImage(event.target) : null;
  if (!image) {
    if (!hoverTrigger.matches(":hover")) hideHoverButton();
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
  if (!src || rect.width < 96 || rect.height < 96) return null;
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
  hoverTrigger.style.left = `${Math.max(10, rect.left + 8)}px`;
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
  state.currentJob = null;
  renderInlineImages([]);

  const cached = imageCache.get(imageUrl);
  if (cached) {
    hydratePanelData(cached);
    return;
  }

  state.panelData = createEmptyPanelData();
  state.panelData.detail = "short";
  state.panelData.aspectRatio = state.settings?.aspectRatio || "1:1";
  renderRatioSelect();
  syncPromptControls();
  setStatus("等待识别...");

  if (state.settings?.autoAnalyze) {
    await analyzeCurrentImage({ force: false });
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

  await runAction("analyze", "正在识别图片内容...", async () => {
    const result = await sendMessage({
      type: "analyze-image",
      payload: {
        imageUrl,
        pageUrl: location.href,
        alt: state.panelImage.alt || ""
      }
    });

    const cached = {
      title: result.title || "图片提示词",
      detail: state.panelData.detail || "short",
      language: state.panelData.language || "zh",
      aspectRatio: state.panelData.aspectRatio || state.settings?.aspectRatio || "1:1",
      prompts: {
        short: {
          en: result.enPromptShort || "",
          zh: result.zhPromptShort || ""
        },
        full: {
          en: result.enPromptFull || "",
          zh: result.zhPromptFull || ""
        }
      }
    };

    imageCache.set(imageUrl, cached);
    hydratePanelData(cached);
  });
}

function switchDetail(detail) {
  state.panelData.detail = detail;
  syncPromptControls();
}

function togglePromptLanguage() {
  const current = state.panelData.language || "zh";
  state.panelData.language = current === "en" ? "zh" : "en";
  syncPromptControls();
  persistPanelImageCache();
}

function hydratePanelData(data) {
  state.panelData = {
    title: data.title || "图片提示词",
    detail: data.detail || "short",
    language: data.language || data.languageByDetail?.[data.detail || "short"] || "zh",
    aspectRatio: data.aspectRatio || state.settings?.aspectRatio || "1:1",
    prompts: {
      short: normalizePromptPair(data.prompts?.short),
      full: normalizePromptPair(data.prompts?.full)
    }
  };

  els.imageTitle.textContent = state.panelData.title || "图片提示词";
  renderRatioSelect();
  syncPromptControls();
  setStatus("识别完成，可直接编辑。", "success");
}

function syncPromptControls() {
  els.detailShort.classList.toggle("is-active", state.panelData.detail === "short");
  els.detailFull.classList.toggle("is-active", state.panelData.detail === "full");
  els.toggleTranslation.textContent = getCurrentLanguage() === "zh" ? "查看英文" : "查看中文";
  els.input.value = getCurrentPrompt();
  updateMeta();
}

function getCurrentPrompt() {
  const detail = state.panelData.detail;
  const language = getCurrentLanguage();
  return state.panelData.prompts[detail]?.[language] || "";
}

function getCurrentLanguage() {
  return state.panelData.language || "zh";
}

function normalizePromptPair(value) {
  if (value && typeof value === "object") {
    return {
      en: String(value.en || "").trim(),
      zh: String(value.zh || "").trim()
    };
  }

  return {
    en: "",
    zh: String(value || "").trim()
  };
}

async function generateFromCurrentPrompt() {
  const prompt = getCurrentPrompt().trim();
  if (!prompt) {
    setStatus("请先识别或输入提示词。", "error");
    return;
  }

  await runAction("generate", "正在生图，结果会显示在当前弹窗...", async () => {
    const result = await sendMessage({
      type: "generate-image",
      payload: {
        prompt,
        aspectRatio: state.panelData.aspectRatio || state.settings?.aspectRatio || "1:1",
        count: state.settings?.imageCount || 1,
        openViewer: false
      }
    });

    state.currentJob = {
      images: result.images || []
    };

    renderInlineImages(state.currentJob.images);
    setStatus("生图完成，预览已更新。", "success");
  });
}

function persistPanelImageCache() {
  if (!state.panelImage) return;
  const imageUrl = state.panelImage.currentSrc || state.panelImage.src;
  if (!imageUrl) return;
  imageCache.set(imageUrl, structuredClone(state.panelData));
}

function renderInlineImages(images) {
  if (!images || images.length === 0) {
    els.inlinePreview.classList.remove("is-visible");
    els.inlineGrid.innerHTML = "";
    return;
  }

  els.inlinePreview.classList.add("is-visible");
  els.inlineGrid.innerHTML = images
    .map((image, index) => {
      const src = `data:${image.mimeType || "image/png"};base64,${image.base64Data}`;
      return `
        <article class="pg-preview-card">
          <div class="pg-preview-frame">
            <img src="${src}" alt="generated preview ${index + 1}" />
            <div class="pg-preview-overlay">
              <button class="pg-preview-action" data-role="download" data-index="${index}" type="button">下载图片</button>
              <button class="pg-preview-action" data-role="viewer" data-index="${index}" type="button">新页面打开</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function getImageDataUrl(index) {
  const image = state.currentJob?.images?.[index];
  if (!image) return "";
  return `data:${image.mimeType || "image/png"};base64,${image.base64Data}`;
}

function triggerDownload(src, filename) {
  const link = document.createElement("a");
  link.href = src;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function updateMeta() {
  const text = els.input.value || "";
  els.charCount.textContent = `${text.length} 字`;
}

async function runAction(actionName, statusText, task) {
  if (state.actionState[actionName]) return;

  state.actionState[actionName] = true;
  syncActionState();
  setStatus(statusText, "working");

  try {
    await task();
  } catch (error) {
    setStatus(error.message || "发生错误，请稍后重试。", "error");
  } finally {
    state.actionState[actionName] = false;
    syncActionState();
    updateMeta();
  }
}

function syncActionState() {
  els.analyze.classList.toggle("is-busy", state.actionState.analyze);
  els.generate.classList.toggle("is-busy", state.actionState.generate);
}

function setStatus(text, tone = "") {
  els.status.textContent = text;
  if (tone) {
    els.status.dataset.tone = tone;
  } else {
    delete els.status.dataset.tone;
  }
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
