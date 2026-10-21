const imageCache = new Map();
const RATIO_OPTIONS = ["1:1", "3:4", "4:3", "9:16", "16:9"];

const MIN_SELECTION_SIZE = 16;
const MIN_BACKGROUND_IMAGE_SIZE = 48;

const state = {
  settings: null,
  hoverImage: null,
  panelSource: null,
  panelOpen: false,
  contextPoint: null,
  regionSelecting: false,
  toastTimer: null,
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
          <button class="pg-chip" id="pg-detail-short" type="button">精简版</button>
          <button class="pg-chip is-active" id="pg-detail-full" type="button">完整版</button>
          <button class="pg-chip" id="pg-toggle-translation" type="button">翻译</button>
          <button class="pg-chip" id="pg-toggle-structure" type="button">查看结构</button>
        </div>
      </div>

      <textarea class="pg-textarea" id="pg-prompt-input" placeholder="这里会显示识别后的提示词，你可以直接修改。"></textarea>
      <div class="pg-structure pg-hidden" id="pg-structure">
        <div class="pg-structure-grid" id="pg-structure-grid"></div>
      </div>
      <div class="pg-meta">
        <span id="pg-status">就绪</span>
        <span id="pg-char-count">0 字</span>
      </div>

      <div class="pg-actions pg-actions-fixed">
        <button class="pg-action pg-fixed-control" id="pg-copy" type="button">复制提示词</button>
        <button class="pg-action pg-fixed-control" id="pg-analyze" type="button">重新识别</button>
      </div>
    </section>

    <section class="pg-section" id="pg-generate-section">
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

const toast = document.createElement("div");
toast.id = "pg-toast";
toast.setAttribute("role", "status");

document.documentElement.append(hoverTrigger, panel, toast);

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
  toggleStructure: panel.querySelector("#pg-toggle-structure"),
  structure: panel.querySelector("#pg-structure"),
  structureGrid: panel.querySelector("#pg-structure-grid"),
  generateSection: panel.querySelector("#pg-generate-section"),
  ratioSelect: panel.querySelector("#pg-ratio-select"),
  inlinePreview: panel.querySelector("#pg-inline-preview"),
  inlineGrid: panel.querySelector("#pg-inline-grid")
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "context-analyze-image") {
    handleContextAnalyze(message.payload || {}).catch((error) => {
      showToast(error.message || "识别失败，请重试。");
    });
  } else if (message?.type === "start-region-selection") {
    startRegionSelection();
  }
  sendResponse({ ok: true });
});

init();

async function init() {
  const response = await sendMessage({ type: "get-settings" });
  state.settings = response;
  state.panelData.detail = "full";
  state.panelData.aspectRatio = state.settings.aspectRatio || "1:1";
  renderRatioSelect();
  bindEvents();
  syncGenerationVisibility();
  syncPromptControls();
}

function createEmptyPanelData() {
  return {
    title: "",
    detail: "full",
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
    },
    structuredPrompt: null,
    analysis: null,
    structureOpen: false
  };
}

function bindEvents() {
  document.addEventListener("pointermove", handlePointerMove, true);
  document.addEventListener("scroll", updateHoverButtonPosition, true);
  window.addEventListener("resize", updateHoverButtonPosition);
  document.addEventListener(
    "contextmenu",
    (event) => {
      state.contextPoint = { x: event.clientX, y: event.clientY };
    },
    true
  );

  hoverTrigger.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!state.hoverImage) return;
    await openPanelForSource(createImageSource(state.hoverImage));
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
  els.toggleStructure.addEventListener("click", toggleStructureView);
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
    triggerDownload(src, `image-lens-${index + 1}.png`);
    return;
  }

  if (role === "viewer") {
    const image = state.currentJob?.images?.[index];
    sendMessage({
      type: "open-viewer",
      payload: {
        prompt: getCurrentPrompt().trim(),
        images: image ? [image] : []
      }
    }).catch((error) => {
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

// A source is what the panel analyzes: an <img> element, an image URL found
// some other way (CSS background, image inside an iframe), or a screenshot of
// part of the page. `key` identifies it in imageCache.
function createImageSource(image) {
  const url = image.currentSrc || image.src;
  return {
    key: url,
    element: image,
    cropElement: image,
    imageUrl: url,
    dataUrl: "",
    previewUrl: url,
    alt: image.alt || "",
    title: image.alt?.trim() || "网页图片",
    label: url
  };
}

function createUrlSource(url, cropElement = null) {
  return {
    key: url,
    element: null,
    cropElement,
    imageUrl: url,
    dataUrl: "",
    previewUrl: url,
    alt: "",
    title: "网页图片",
    label: url
  };
}

function createCapturedSource(dataUrl, title) {
  return {
    key: `capture:${Date.now()}`,
    element: null,
    cropElement: null,
    imageUrl: "",
    dataUrl,
    previewUrl: dataUrl,
    alt: "",
    title,
    label: "页面截图"
  };
}

async function openPanelForSource(source) {
  state.settings = await sendMessage({ type: "get-settings" });
  state.panelSource = source;
  state.panelOpen = true;
  panel.classList.add("pg-open");

  els.previewImage.src = source.previewUrl;
  els.imageTitle.textContent = source.title;
  els.imageUrl.textContent = truncateMiddle(source.label, 52);
  state.currentJob = null;
  renderInlineImages([]);

  const cached = imageCache.get(source.key);
  if (cached) {
    hydratePanelData(cached);
    return;
  }

  state.panelData = createEmptyPanelData();
  state.panelData.detail = "full";
  state.panelData.aspectRatio = state.settings?.aspectRatio || "1:1";
  renderRatioSelect();
  syncGenerationVisibility();
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
  const targetSource = state.panelSource;
  if (!targetSource?.key) return;

  if (!force && imageCache.has(targetSource.key)) {
    hydratePanelData(imageCache.get(targetSource.key));
    return;
  }

  await runAction("analyze", "正在识别图片内容...", async () => {
    const imageDataUrl = targetSource.dataUrl || (await captureImageDataUrl(targetSource.element));
    const screenshotCrop = getViewportCrop(targetSource.cropElement);
    const result = await sendMessage({
      type: "analyze-image",
      payload: {
        imageUrl: targetSource.imageUrl,
        imageDataUrl,
        screenshotCrop,
        pageUrl: location.href,
        alt: targetSource.alt
      }
    });

    const cached = {
      title: result.title || "图片提示词",
      detail: state.panelData.detail || "full",
      language: state.panelData.language || "zh",
      aspectRatio: state.panelData.aspectRatio || state.settings?.aspectRatio || "1:1",
      structuredPrompt: result.structuredPrompt || null,
      analysis: result.analysis || null,
      structureOpen: state.panelData.structureOpen || false,
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

    imageCache.set(targetSource.key, cached);
    // The user may have opened the panel on another image while this request
    // was in flight; only show the result if it still belongs to the panel.
    if (state.panelSource === targetSource) {
      hydratePanelData(cached);
    }
  });

  // An analysis for a newly opened image is skipped while another one is busy,
  // so start it once the previous request has finished.
  const currentSource = state.panelSource;
  if (
    state.panelOpen &&
    currentSource &&
    currentSource !== targetSource &&
    !imageCache.has(currentSource.key) &&
    state.settings?.autoAnalyze
  ) {
    await analyzeCurrentImage({ force: false });
  }
}

function switchDetail(detail) {
  state.panelData.detail = detail;
  syncPromptControls();
}

function togglePromptLanguage() {
  const current = state.panelData.language || "zh";
  state.panelData.language = current === "en" ? "zh" : "en";
  syncPromptControls();
  renderStructureView();
  persistPanelImageCache();
}

function hydratePanelData(data) {
  state.panelData = {
    title: data.title || "图片提示词",
    detail: data.detail || "full",
    language: data.language || data.languageByDetail?.[data.detail || "full"] || "zh",
    aspectRatio: data.aspectRatio || state.settings?.aspectRatio || "1:1",
    structuredPrompt: data.structuredPrompt || null,
    analysis: data.analysis || null,
    structureOpen: Boolean(data.structureOpen),
    prompts: {
      short: normalizePromptPair(data.prompts?.short),
      full: normalizePromptPair(data.prompts?.full)
    }
  };

  els.imageTitle.textContent = state.panelData.title || "图片提示词";
  renderRatioSelect();
  syncGenerationVisibility();
  syncPromptControls();
  renderStructureView();
  setStatus("识别完成，可直接编辑。", "success");
}

function syncPromptControls() {
  els.detailShort.classList.toggle("is-active", state.panelData.detail === "short");
  els.detailFull.classList.toggle("is-active", state.panelData.detail === "full");
  els.toggleTranslation.textContent = getCurrentLanguage() === "zh" ? "查看英文" : "查看中文";
  els.toggleStructure.textContent = state.panelData.structureOpen ? "隐藏结构" : "查看结构";
  els.toggleStructure.classList.toggle("is-active", state.panelData.structureOpen);
  els.input.value = getCurrentPrompt();
  updateMeta();
}

function toggleStructureView() {
  state.panelData.structureOpen = !state.panelData.structureOpen;
  syncPromptControls();
  renderStructureView();
  persistPanelImageCache();
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

function renderStructureView() {
  const entries = getStructureEntries();
  const visible = state.panelData.structureOpen && entries.length > 0;
  els.structure.classList.toggle("pg-hidden", !visible);

  if (!visible) {
    els.structureGrid.innerHTML = "";
    return;
  }

  els.structureGrid.innerHTML = entries
    .map(
      (entry) => `
        <div class="pg-structure-row">
          <span class="pg-structure-label">${escapeHtml(entry.label)}</span>
          <p class="pg-structure-value">${escapeHtml(entry.value)}</p>
        </div>
      `
    )
    .join("");
}

function getStructureEntries() {
  const language = getCurrentLanguage();
  const prompt = language === "en" ? state.panelData.structuredPrompt?.enFull : state.panelData.structuredPrompt?.zhFull;
  const entries = parseStructuredPrompt(prompt);
  if (entries.length >= 6 && (language === "en" || entriesHaveChinese(entries))) return orderStructureEntries(entries);

  const fullPrompt = state.panelData.prompts.full?.[language] || "";
  const labeledEntries = parseStructuredPrompt(fullPrompt);
  if (labeledEntries.length >= 6 && (language === "en" || entriesHaveChinese(labeledEntries))) {
    return orderStructureEntries(labeledEntries);
  }

  const analysisEntries = buildStructureEntriesFromAnalysis(state.panelData.analysis);
  if (language === "zh" && !entriesHaveChinese(analysisEntries)) return [];
  return analysisEntries;
}

function parseStructuredPrompt(prompt) {
  return String(prompt || "")
    .split(/[;；]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([^:：]+)\s*[:：]\s*(.+)$/);
      if (!match) return null;

      const label = normalizeStructureLabel(match[1]);
      const value = match[2].trim();
      return label && value ? { label, value } : null;
    })
    .filter(Boolean);
}

function normalizeStructureLabel(label) {
  const rawLabel = String(label || "").trim();
  const normalized = rawLabel.toLowerCase().replace(/\s+/g, "");

  if (/^subject|主体/.test(normalized)) return "主体";
  if (/^style|风格/.test(normalized)) return "风格";
  if (/^lighting|光线|光影/.test(normalized)) return "光线";
  if (/^camera|镜头/.test(normalized)) return "镜头";
  if (/^environment|环境/.test(normalized)) return "环境";
  if (/^material|材质/.test(normalized)) return "材质";
  if (/^composition|构图/.test(normalized)) return "构图";
  if (/^rendering|渲染/.test(normalized)) return "渲染";
  return "";
}

function orderStructureEntries(entries) {
  const labelOrder = ["主体", "风格", "光线", "镜头", "环境", "材质", "构图", "渲染"];
  const entryMap = new Map();

  for (const entry of entries) {
    if (!entryMap.has(entry.label)) entryMap.set(entry.label, entry);
  }

  return labelOrder.map((label) => entryMap.get(label)).filter(Boolean);
}

function entriesHaveChinese(entries) {
  return entries.some((entry) => /[\u4e00-\u9fff]/.test(entry.value));
}

function buildStructureEntriesFromAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") return [];

  const rows = [
    ["主体", joinValues([analysis.subject?.main, ...(analysis.subject?.attributes || []), analysis.subject?.action])],
    ["风格", joinValues([analysis.style?.medium, analysis.style?.genre, analysis.style?.mood, analysis.style?.referenceLook])],
    ["光线", joinValues([analysis.lighting?.direction, analysis.lighting?.quality, analysis.lighting?.effect, analysis.lighting?.timeOfDay])],
    ["镜头", joinValues([analysis.camera?.focalLength, analysis.camera?.aperture, analysis.camera?.angle, analysis.camera?.shotType, analysis.camera?.depthOfField])],
    ["环境", joinValues([analysis.environment?.sceneType, analysis.environment?.backgroundMaterial, analysis.environment?.spatialRelation])],
    ["材质", joinValues([analysis.material?.surface, analysis.material?.microDetail, ...(analysis.material?.opticalProperties || [])])],
    ["构图", joinValues([analysis.composition?.layout, analysis.composition?.subjectPlacement, analysis.composition?.foreground, analysis.composition?.background, analysis.composition?.leadingLines, analysis.composition?.symmetry])],
    ["渲染", joinValues([analysis.rendering?.colorGrade, ...(analysis.rendering?.deviceLook || []), ...(analysis.rendering?.priorityTerms || [])])]
  ];

  return rows
    .map(([label, value]) => ({ label, value }))
    .filter((entry) => entry.value);
}

function joinValues(values) {
  return values.filter(Boolean).join("，");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function generateFromCurrentPrompt() {
  if (!state.settings?.imageGenerationEnabled) {
    setStatus("生图功能当前已关闭。", "error");
    return;
  }

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
  if (!state.panelSource?.key) return;
  imageCache.set(state.panelSource.key, structuredClone(state.panelData));
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

function syncGenerationVisibility() {
  const enabled = Boolean(state.settings?.imageGenerationEnabled);
  els.generateSection?.classList.toggle("pg-hidden", !enabled);
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

async function captureImageDataUrl(image) {
  if (!(image instanceof HTMLImageElement)) return "";

  const src = image.currentSrc || image.src || "";
  if (src.startsWith("data:")) return src;

  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (width > 0 && height > 0) {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(image, 0, 0, width, height);
          const blob = await canvas.convertToBlob({
            type: "image/png"
          });
          return await blobToDataUrl(blob);
        }
      }
    }
  } catch (_error) {
    // Cross-origin images may taint the canvas. Fallback to URL fetch in the background worker.
  }

  try {
    const response = await fetch(src, {
      credentials: "include"
    });
    if (response.ok) {
      const blob = await response.blob();
      return await blobToDataUrl(blob);
    }
  } catch (_error) {
    // Some sites still block content-script fetches. The background worker keeps the final fallback path.
  }

  return "";
}

function getViewportCrop(element) {
  if (!(element instanceof Element)) return null;

  const rect = element.getBoundingClientRect();
  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);

  if (width <= 1 || height <= 1) return null;

  return {
    x,
    y,
    width,
    height,
    devicePixelRatio: window.devicePixelRatio || 1
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image blob."));
    reader.readAsDataURL(blob);
  });
}

async function handleContextAnalyze({ srcUrl, inSubframe }) {
  const point = inSubframe ? null : state.contextPoint;
  const target = point ? findTargetAtPoint(point.x, point.y) : null;

  if (target?.image) {
    await openPanelForSource(createImageSource(target.image));
    return;
  }

  if (target?.backgroundUrl) {
    await openPanelForSource(createUrlSource(target.backgroundUrl, target.element));
    return;
  }

  if (target?.element) {
    // Canvas and video pixels are often unreadable (cross-origin, WebGL, DRM),
    // so analyze what is on screen instead.
    const dataUrl = await captureViewportRegion(getViewportCrop(target.element));
    const title = target.element instanceof HTMLVideoElement ? "视频画面" : "画布内容";
    await openPanelForSource(createCapturedSource(dataUrl, title));
    return;
  }

  if (srcUrl) {
    await openPanelForSource(createUrlSource(srcUrl));
    return;
  }

  showToast("这里没有找到图片，请拖动框选要分析的区域。");
  startRegionSelection();
}

// elementsFromPoint also returns elements underneath transparent overlays,
// which is how sites like Pinterest and Instagram cover their images.
function findTargetAtPoint(x, y) {
  for (const element of document.elementsFromPoint(x, y)) {
    if (isOwnUiElement(element)) continue;
    if (element === document.documentElement || element === document.body) continue;

    if (element instanceof HTMLImageElement && (element.currentSrc || element.src)) {
      return { image: element };
    }
    if (element instanceof HTMLCanvasElement || element instanceof HTMLVideoElement) {
      return { element };
    }

    const backgroundUrl = getBackgroundImageUrl(element);
    if (backgroundUrl) {
      return { element, backgroundUrl };
    }
  }

  // elementsFromPoint skips elements with pointer-events: none.
  const image = findImageContainingPoint(x, y);
  return image ? { image } : null;
}

function findImageContainingPoint(x, y) {
  let best = null;
  let bestArea = Infinity;

  for (const image of document.images) {
    if (!(image.currentSrc || image.src)) continue;
    const rect = image.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;

    const area = rect.width * rect.height;
    if (area > 0 && area < bestArea) {
      best = image;
      bestArea = area;
    }
  }

  return best;
}

function getBackgroundImageUrl(element) {
  const rect = element.getBoundingClientRect();
  // Skips icon sprites, which are small and would analyze the whole sheet.
  if (rect.width < MIN_BACKGROUND_IMAGE_SIZE || rect.height < MIN_BACKGROUND_IMAGE_SIZE) return "";

  const match = getComputedStyle(element).backgroundImage.match(/url\(\s*(["']?)(.*?)\1\s*\)/);
  if (!match?.[2]) return "";

  try {
    return new URL(match[2], document.baseURI).href;
  } catch (_error) {
    return "";
  }
}

function isOwnUiElement(element) {
  return (
    element === hoverTrigger ||
    element === toast ||
    panel.contains(element) ||
    Boolean(element.closest?.("#pg-region-overlay"))
  );
}

function startRegionSelection() {
  if (state.regionSelecting) return;
  state.regionSelecting = true;
  hideHoverButton();

  const overlay = document.createElement("div");
  overlay.id = "pg-region-overlay";
  overlay.innerHTML = `
    <div class="pg-region-hint">拖动框选要分析的区域，按 Esc 取消</div>
    <div class="pg-region-box"></div>
  `;
  const box = overlay.querySelector(".pg-region-box");
  let start = null;
  let selection = null;

  const updateSelection = (event) => {
    const left = Math.max(0, Math.min(start.x, event.clientX));
    const top = Math.max(0, Math.min(start.y, event.clientY));
    const right = Math.min(window.innerWidth, Math.max(start.x, event.clientX));
    const bottom = Math.min(window.innerHeight, Math.max(start.y, event.clientY));
    selection = { x: left, y: top, width: right - left, height: bottom - top };

    box.style.left = `${selection.x}px`;
    box.style.top = `${selection.y}px`;
    box.style.width = `${selection.width}px`;
    box.style.height = `${selection.height}px`;
    box.classList.add("is-visible");
  };

  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finish(null);
  };

  const finish = async (selected) => {
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown, true);
    state.regionSelecting = false;
    if (!selected) return;

    try {
      const dataUrl = await captureViewportRegion({
        ...selected,
        devicePixelRatio: window.devicePixelRatio || 1
      });
      await openPanelForSource(createCapturedSource(dataUrl, "框选区域"));
    } catch (error) {
      showToast(error.message || "截图失败，请重试。");
    }
  };

  overlay.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    overlay.setPointerCapture(event.pointerId);
    updateSelection(event);
  });
  overlay.addEventListener("pointermove", (event) => {
    if (start) updateSelection(event);
  });
  overlay.addEventListener("pointerup", (event) => {
    if (!start) return;
    updateSelection(event);
    start = null;
    const isLargeEnough =
      selection.width >= MIN_SELECTION_SIZE && selection.height >= MIN_SELECTION_SIZE;
    finish(isLargeEnough ? selection : null);
  });
  overlay.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    finish(null);
  });

  document.addEventListener("keydown", onKeyDown, true);
  document.documentElement.append(overlay);
}

// The screenshot is taken by the background worker from what is painted on
// screen, so the panel and buttons are hidden until the capture is done.
async function captureViewportRegion(crop) {
  if (!crop) {
    throw new Error("选中的内容不在可见范围内，请滚动到可见位置后重试。");
  }

  const restore = hideOwnUiForCapture();
  try {
    await waitForNextPaint();
    const result = await sendMessage({ type: "capture-region", payload: { crop } });
    return result.dataUrl;
  } finally {
    restore();
  }
}

function hideOwnUiForCapture() {
  const elements = [panel, hoverTrigger, toast];
  const previous = elements.map((element) => element.style.visibility);
  elements.forEach((element) => {
    element.style.visibility = "hidden";
  });

  return () => {
    elements.forEach((element, index) => {
      element.style.visibility = previous[index];
    });
  };
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30)));
  });
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 3200);
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension request failed.");
  }
  return response.data;
}
