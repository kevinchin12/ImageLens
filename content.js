const imageCache = new Map();
const RATIO_OPTIONS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const DEFAULT_TRANSLATOR = globalThis.ImageLensI18n.createTranslator("auto");

const MIN_SELECTION_SIZE = 16;
const MIN_BACKGROUND_IMAGE_SIZE = 48;
// Same order as SECTION_KEYS in prompt-analysis.js.
const STRUCTURE_KEYS = [
  "subject",
  "environment",
  "style",
  "lighting",
  "color",
  "camera",
  "composition",
  "material",
  "rendering"
];

const state = {
  settings: null,
  hoverImage: null,
  panelSource: null,
  panelOpen: false,
  contextPoint: null,
  regionSelecting: false,
  toastTimer: null,
  pointer: null,
  hoverFrame: 0,
  currentJob: null,
  panelData: createEmptyPanelData(),
  actionState: {
    analyze: false,
    generate: false
  }
};

// Stroke icons drawn with currentColor so they follow the theme.
const ICONS = {
  logo: '<svg viewBox="0 0 24 24" class="pg-icon-fill"><path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  wand: '<svg viewBox="0 0 24 24"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/></svg>'
};

// Width and height of the little shape drawn in each ratio button.
const RATIO_SHAPES = {
  "1:1": [14, 14],
  "3:4": [12, 16],
  "4:3": [16, 12],
  "9:16": [10, 17],
  "16:9": [18, 10]
};

const hoverTrigger = document.createElement("button");
hoverTrigger.id = "pg-hover-trigger";
hoverTrigger.type = "button";
hoverTrigger.title = DEFAULT_TRANSLATOR.t("panelHoverTitle");
hoverTrigger.innerHTML = ICONS.logo;

const panel = document.createElement("aside");
panel.id = "pg-panel";
panel.innerHTML = `
  <div class="pg-shell">
    <header class="pg-header">
      <div class="pg-brand">
        <span class="pg-logo">${ICONS.logo}</span>
        <strong id="pg-brand">${escapeHtml(DEFAULT_TRANSLATOR.t("appName"))}</strong>
      </div>
      <div class="pg-header-actions">
        <button class="pg-icon-button" id="pg-open-options" type="button">${ICONS.settings}</button>
        <button class="pg-icon-button" id="pg-close" type="button">${ICONS.close}</button>
      </div>
    </header>

    <section class="pg-source">
      <img class="pg-thumb" id="pg-preview-image" alt="" />
      <div class="pg-source-meta">
        <strong id="pg-image-title"></strong>
        <span id="pg-image-url"></span>
      </div>
      <button class="pg-icon-button" id="pg-analyze" type="button">${ICONS.refresh}</button>
    </section>

    <div class="pg-toolbar">
      <div class="pg-tabs" role="tablist">
        <button class="pg-tab" id="pg-tab-prompt" type="button" role="tab"></button>
        <button class="pg-tab" id="pg-tab-structure" type="button" role="tab"></button>
      </div>
      <div class="pg-seg">
        <button id="pg-detail-full" type="button"></button>
        <button id="pg-detail-short" type="button"></button>
      </div>
      <div class="pg-seg" id="pg-lang-seg">
        <button id="pg-lang-zh" type="button">中</button>
        <button id="pg-lang-en" type="button">EN</button>
      </div>
    </div>

    <div class="pg-prompt-box">
      <textarea class="pg-textarea" id="pg-prompt-input"></textarea>
      <div class="pg-structure pg-hidden" id="pg-structure">
        <div class="pg-structure-grid" id="pg-structure-grid"></div>
      </div>
      <div class="pg-meta">
        <span class="pg-status" id="pg-status"></span>
        <span id="pg-char-count"></span>
      </div>
    </div>

    <div class="pg-section-chips pg-hidden" id="pg-section-chips"></div>

    <div class="pg-actions">
      <button class="pg-btn pg-btn-primary" id="pg-copy" type="button">${ICONS.copy}<span id="pg-copy-label"></span></button>
    </div>

    <section class="pg-generate" id="pg-generate-section">
      <div class="pg-generate-head">
        <strong id="pg-generate-heading"></strong>
        <span id="pg-generate-meta"></span>
      </div>
      <div class="pg-ratios" id="pg-ratios" role="radiogroup"></div>
      <button class="pg-btn pg-btn-secondary" id="pg-generate" type="button">${ICONS.wand}<span id="pg-generate-label"></span></button>
      <div class="pg-inline-preview" id="pg-inline-preview">
        <div class="pg-inline-grid" id="pg-inline-grid"></div>
      </div>
    </section>
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
  copyLabel: panel.querySelector("#pg-copy-label"),
  generate: panel.querySelector("#pg-generate"),
  generateLabel: panel.querySelector("#pg-generate-label"),
  generateMeta: panel.querySelector("#pg-generate-meta"),
  close: panel.querySelector("#pg-close"),
  openOptions: panel.querySelector("#pg-open-options"),
  tabPrompt: panel.querySelector("#pg-tab-prompt"),
  tabStructure: panel.querySelector("#pg-tab-structure"),
  detailShort: panel.querySelector("#pg-detail-short"),
  detailFull: panel.querySelector("#pg-detail-full"),
  langSeg: panel.querySelector("#pg-lang-seg"),
  langZh: panel.querySelector("#pg-lang-zh"),
  langEn: panel.querySelector("#pg-lang-en"),
  structure: panel.querySelector("#pg-structure"),
  structureGrid: panel.querySelector("#pg-structure-grid"),
  sectionChips: panel.querySelector("#pg-section-chips"),
  generateSection: panel.querySelector("#pg-generate-section"),
  ratios: panel.querySelector("#pg-ratios"),
  inlinePreview: panel.querySelector("#pg-inline-preview"),
  inlineGrid: panel.querySelector("#pg-inline-grid")
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "context-analyze-image") {
    handleContextAnalyze(message.payload || {}).catch((error) => {
      showToast(error.message || t("contextAnalyzeFailed"));
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
  state.panelData.language = getDefaultPromptLanguage();
  state.panelData.aspectRatio = state.settings.aspectRatio || "1:1";
  renderRatioButtons();
  bindEvents();
  applyStaticTranslations();
  syncGenerationVisibility();
  syncPromptControls();
}

function createEmptyPanelData() {
  return {
    title: "",
    detail: "full",
    language: "en",
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
    ratioChosen: false,
    sections: {},
    languages: [],
    structureOpen: false
  };
}

function getTranslator() {
  return globalThis.ImageLensI18n.createTranslator(state.settings?.uiLanguage || "auto");
}

function t(key, values) {
  return getTranslator().t(key, values);
}

function applyStaticTranslations() {
  const translator = getTranslator();
  // Tells Chrome which language's glyph shapes to use for Chinese text.
  panel.lang = translator.messages.htmlLang;
  toast.lang = translator.messages.htmlLang;
  hoverTrigger.title = translator.t("panelHoverTitle");
  panel.querySelector("#pg-brand").textContent = translator.t("appName");
  setIconLabel(els.openOptions, translator.t("panelOpenSettings"));
  setIconLabel(els.close, translator.t("panelClose"));
  setIconLabel(els.analyze, translator.t("panelReanalyze"));
  els.tabPrompt.textContent = translator.t("panelPromptTitle");
  els.tabStructure.textContent = translator.t("panelStructureTab");
  els.detailShort.textContent = translator.t("panelShort");
  els.detailFull.textContent = translator.t("panelFull");
  els.input.placeholder = translator.t("panelPromptPlaceholder");
  els.copyLabel.textContent = translator.t("panelCopy");
  panel.querySelector("#pg-generate-heading").textContent = translator.t("panelGenerateTitle");
  els.ratios.setAttribute("aria-label", translator.t("panelAspectRatio"));
  els.generateLabel.textContent = translator.t("panelGenerate");
  syncGenerateMeta();
}

function setIconLabel(button, label) {
  button.title = label;
  button.setAttribute("aria-label", label);
}

function syncGenerateMeta() {
  const provider =
    state.settings?.imageProvider === "openai-compatible" ? t("providerOpenAICompatible") : t("providerGemini");
  els.generateMeta.textContent = t("panelGenerateMeta", { provider, count: state.settings?.imageCount || 1 });
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
  els.langZh.addEventListener("click", () => setPromptLanguage("zh"));
  els.langEn.addEventListener("click", () => setPromptLanguage("en"));
  els.tabPrompt.addEventListener("click", () => setStructureOpen(false));
  els.tabStructure.addEventListener("click", () => setStructureOpen(true));
  els.analyze.addEventListener("click", () => analyzeCurrentImage({ force: true }));
  els.previewImage.addEventListener("load", syncSourceMeta);

  els.ratios.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ratio]");
    if (!button) return;
    state.panelData.aspectRatio = button.dataset.ratio;
    state.panelData.ratioChosen = true;
    renderRatioButtons();
    persistPanelImageCache();
  });

  els.copy.addEventListener("click", async () => {
    const text = getCurrentPrompt().trim();
    if (!text) {
      setStatus(t("panelNoPromptToCopy"), "error");
      return;
    }
    await copyText(text, t("panelPromptCopied"));
  });

  els.sectionChips.addEventListener("click", async (event) => {
    const chip = event.target.closest("[data-section]");
    if (!chip) return;
    const entry = getStructureEntries().find((item) => item.label === chip.dataset.section);
    if (!entry) return;
    await copyText(entry.value, t("panelSectionCopied", { section: getStructureLabel(entry.label) }));
  });

  els.generate.addEventListener("click", () => generateFromCurrentPrompt());
  els.inlineGrid.addEventListener("click", handleInlinePreviewClick);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(successMessage, "success");
  } catch (_error) {
    setStatus(t("panelCopyFailed"), "error");
  }
}

function renderRatioButtons() {
  const current = state.panelData.aspectRatio || "1:1";
  els.ratios.innerHTML = RATIO_OPTIONS.map((ratio) => {
    const [width, height] = RATIO_SHAPES[ratio];
    const active = ratio === current;
    return `
      <button class="pg-ratio${active ? " is-active" : ""}" data-ratio="${ratio}" type="button" role="radio" aria-checked="${active}">
        <span class="pg-ratio-shape"><i style="width:${width}px;height:${height}px"></i></span><span>${ratio}</span>
      </button>
    `;
  }).join("");
}

// One button per filled-in structure section; clicking copies that section in
// the prompt language shown.
function renderSectionChips() {
  const entries = getStructureEntries();
  els.sectionChips.classList.toggle("pg-hidden", entries.length === 0);
  els.sectionChips.innerHTML = entries
    .map(
      (entry) =>
        `<button class="pg-section-chip" data-section="${entry.label}" title="${escapeHtml(entry.value)}" type="button">${escapeHtml(getStructureLabel(entry.label))}</button>`
    )
    .join("");
}

// Shows "site" under the title, plus "· width × height" once the thumbnail
// has loaded. Until then the image element still reports the previous size.
function syncSourceMeta(event) {
  const source = state.panelSource;
  if (!source) return;

  const parts = [getSourceHost(source)];
  const { naturalWidth, naturalHeight } = els.previewImage;
  if (event?.type === "load" && naturalWidth && naturalHeight) {
    parts.push(`${naturalWidth} × ${naturalHeight}`);
    // Generate in the source's shape unless the user picked a ratio.
    if (!state.panelData.ratioChosen) {
      state.panelData.aspectRatio = getNearestRatio(naturalWidth, naturalHeight);
      renderRatioButtons();
    }
  }
  els.imageUrl.textContent = parts.filter(Boolean).join(" · ");
  els.imageUrl.title = source.imageUrl || "";
}

// Compares on a log scale so 4:3 and 3:4 are equally far from 1:1.
function getNearestRatio(width, height) {
  const target = Math.log(width / height);
  let best = RATIO_OPTIONS[0];
  let bestDistance = Infinity;

  for (const ratio of RATIO_OPTIONS) {
    const [w, h] = ratio.split(":").map(Number);
    const distance = Math.abs(Math.log(w / h) - target);
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }

  return best;
}

function getSourceHost(source) {
  if (!source.imageUrl) return t("panelScreenshotLabel");
  try {
    const url = new URL(source.imageUrl);
    return /^https?:$/.test(url.protocol) ? url.hostname.replace(/^www\./, "") : location.hostname;
  } catch (_error) {
    return location.hostname;
  }
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
      setStatus(error.message || t("panelOpenViewerFailed"), "error");
    });
  }
}

// Pointer moves fire far more often than the screen repaints, so the lookup
// runs at most once per frame with the latest pointer position.
function handlePointerMove(event) {
  if (state.regionSelecting) return;
  if (state.panelOpen && panel.contains(event.target)) return;

  state.pointer = { x: event.clientX, y: event.clientY, target: event.target };
  if (!state.hoverFrame) {
    state.hoverFrame = requestAnimationFrame(updateHoverTarget);
  }
}

function updateHoverTarget() {
  state.hoverFrame = 0;
  const { x, y, target } = state.pointer || {};

  const image =
    (target instanceof Element ? findEligibleImage(target) : null) || findEligibleImageAtPoint(x, y);
  if (!image) {
    if (!hoverTrigger.matches(":hover")) hideHoverButton();
    return;
  }

  state.hoverImage = image;
  updateHoverButtonPosition();
}

function findEligibleImage(startNode) {
  const image = startNode.closest("img");
  return image && isEligibleImage(image) ? image : null;
}

// Sites like Pinterest and Instagram lay transparent elements over their
// images, so the pointer is never on the <img> itself. Look through the stack
// at the pointer and use the first image underneath.
function findEligibleImageAtPoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  for (const element of document.elementsFromPoint(x, y)) {
    if (isOwnUiElement(element)) continue;
    if (element instanceof HTMLImageElement) {
      return isEligibleImage(element) ? element : null;
    }
  }
  return null;
}

function isEligibleImage(image) {
  const rect = image.getBoundingClientRect();
  const src = image.currentSrc || image.src;
  return Boolean(src) && rect.width >= 96 && rect.height >= 96;
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
    title: image.alt?.trim() || "",
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
    title: "",
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
    label: ""
  };
}

async function openPanelForSource(source) {
  state.settings = await sendMessage({ type: "get-settings" });
  applyStaticTranslations();
  state.panelSource = source;
  state.panelOpen = true;
  panel.classList.add("pg-open");

  els.previewImage.src = source.previewUrl;
  els.imageTitle.textContent = source.title || t("panelWebImage");
  syncSourceMeta();
  state.currentJob = null;
  renderInlineImages([]);

  const cached = imageCache.get(source.key);
  if (cached) {
    hydratePanelData(cached);
    return;
  }

  state.panelData = createEmptyPanelData();
  state.panelData.detail = "full";
  state.panelData.language = getDefaultPromptLanguage();
  state.panelData.aspectRatio = state.settings?.aspectRatio || "1:1";
  renderRatioButtons();
  renderSectionChips();
  syncGenerationVisibility();
  syncPromptControls();
  renderStructureView();
  setStatus(t("panelWaitingAnalyze"));

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

  await runAction("analyze", t("panelAnalyzing"), async () => {
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
      title: pickByUiLanguage(result.title) || t("panelPromptTitleFallback"),
      detail: state.panelData.detail || "full",
      language: state.panelData.language || getDefaultPromptLanguage(),
      aspectRatio: state.panelData.aspectRatio || state.settings?.aspectRatio || "1:1",
      ratioChosen: state.panelData.ratioChosen,
      sections: result.sections || {},
      languages: Array.isArray(result.languages) ? result.languages : ["en"],
      structureOpen: state.panelData.structureOpen || false,
      prompts: {
        short: normalizePromptPair(result.prompts?.short),
        full: normalizePromptPair(result.prompts?.full)
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

function setPromptLanguage(language) {
  state.panelData.language = isPromptLanguageAvailable(language) ? language : "en";
  syncPromptControls();
  renderSectionChips();
  renderStructureView();
  persistPanelImageCache();
}

// Chinese is offered when it is turned on in settings and, once an image has
// been analyzed, when the model actually returned it.
function isPromptLanguageAvailable(language) {
  if (language === "en") return true;
  if (!state.settings?.enableChineseRecognition) return false;
  const languages = state.panelData.languages || [];
  return languages.length === 0 || languages.includes(language);
}

function pickByUiLanguage(value) {
  if (typeof value === "string") return value;
  return value?.[getTranslator().language] || value?.en || value?.zh || "";
}

function hydratePanelData(data) {
  state.panelData = {
    title: data.title || t("panelPromptTitleFallback"),
    detail: data.detail || "full",
    language: data.language || "en",
    aspectRatio: data.aspectRatio || state.settings?.aspectRatio || "1:1",
    ratioChosen: Boolean(data.ratioChosen),
    sections: data.sections || {},
    languages: Array.isArray(data.languages) ? data.languages : [],
    structureOpen: Boolean(data.structureOpen),
    prompts: {
      short: normalizePromptPair(data.prompts?.short),
      full: normalizePromptPair(data.prompts?.full)
    }
  };
  if (!isPromptLanguageAvailable(state.panelData.language)) {
    state.panelData.language = "en";
  }

  els.imageTitle.textContent = state.panelData.title || t("panelPromptTitleFallback");
  renderRatioButtons();
  renderSectionChips();
  syncGenerationVisibility();
  syncPromptControls();
  renderStructureView();
  setStatus(t("panelAnalyzeDone"), "success");
}

function syncPromptControls() {
  const structureOpen = state.panelData.structureOpen;
  setPressed(els.tabPrompt, !structureOpen, "aria-selected");
  setPressed(els.tabStructure, structureOpen, "aria-selected");
  setPressed(els.detailShort, state.panelData.detail === "short");
  setPressed(els.detailFull, state.panelData.detail === "full");
  els.langSeg.classList.toggle("pg-hidden", !isPromptLanguageAvailable("zh"));
  setPressed(els.langZh, getCurrentLanguage() === "zh");
  setPressed(els.langEn, getCurrentLanguage() === "en");
  els.input.classList.toggle("pg-hidden", structureOpen);
  els.charCount.classList.toggle("pg-hidden", structureOpen);
  els.input.value = getCurrentPrompt();
  updateMeta();
}

function setPressed(button, active, attribute = "aria-pressed") {
  button.classList.toggle("is-active", active);
  button.setAttribute(attribute, String(active));
}

function setStructureOpen(open) {
  state.panelData.structureOpen = open;
  syncPromptControls();
  renderStructureView();
  persistPanelImageCache();
}

function getCurrentPrompt() {
  const detail = state.panelData.detail;
  const language = getCurrentLanguage();
  return state.panelData.prompts[detail]?.[language] || "";
}

// Chinese prompts show first when they are generated and the UI is Chinese.
function getDefaultPromptLanguage() {
  return state.settings?.enableChineseRecognition && getTranslator().language === "zh" ? "zh" : "en";
}

function getCurrentLanguage() {
  return state.panelData.language || "en";
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
  const visible = state.panelData.structureOpen;
  els.structure.classList.toggle("pg-hidden", !visible);
  els.structureGrid.dataset.uiLanguage = getTranslator().language;

  if (!visible) {
    els.structureGrid.innerHTML = "";
    return;
  }

  if (entries.length === 0) {
    els.structureGrid.innerHTML = `<p class="pg-structure-empty">${escapeHtml(t("panelStructureEmpty"))}</p>`;
    return;
  }

  els.structureGrid.innerHTML = entries
    .map(
      (entry) => `
        <div class="pg-structure-row">
          <span class="pg-structure-label">${escapeHtml(getStructureLabel(entry.label))}</span>
          <p class="pg-structure-value">${escapeHtml(entry.value)}</p>
        </div>
      `
    )
    .join("");
}

function getStructureEntries() {
  const language = getCurrentLanguage();
  const sections = state.panelData.sections || {};
  return STRUCTURE_KEYS.map((key) => ({
    label: key,
    value: sections[key]?.[language] || sections[key]?.en || ""
  })).filter((entry) => entry.value);
}

function getStructureLabel(key) {
  const labelMap = {
    subject: "structureSubject",
    environment: "structureEnvironment",
    style: "structureStyle",
    lighting: "structureLighting",
    color: "structureColor",
    camera: "structureCamera",
    composition: "structureComposition",
    material: "structureMaterial",
    rendering: "structureRendering"
  };

  return t(labelMap[key] || key);
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
    setStatus(t("panelGenerationDisabled"), "error");
    return;
  }

  const prompt = getCurrentPrompt().trim();
  if (!prompt) {
    setStatus(t("panelPromptRequired"), "error");
    return;
  }

  await runAction("generate", t("panelGenerating"), async () => {
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
    setStatus(t("panelGenerated"), "success");
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
              <button class="pg-preview-action" data-role="download" data-index="${index}" type="button">${escapeHtml(t("panelDownloadImage"))}</button>
              <button class="pg-preview-action" data-role="viewer" data-index="${index}" type="button">${escapeHtml(t("panelOpenViewer"))}</button>
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
  els.charCount.textContent = t("panelChars", { count: text.length });
}

async function runAction(actionName, statusText, task) {
  if (state.actionState[actionName]) return;

  state.actionState[actionName] = true;
  syncActionState();
  setStatus(statusText, "working");

  try {
    await task();
  } catch (error) {
    setStatus(error.message || t("panelActionError"), "error");
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
          const blob = await canvas.convertToBlob({ type: "image/png" });
          return await blobToDataUrl(blob);
        }
      }
    }
  } catch (_error) {
    // Cross-origin images can taint the canvas. Fallbacks continue below.
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
    // Some sites block content-script fetches. The background worker has a final fallback path.
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
    const title = t(target.element instanceof HTMLVideoElement ? "panelVideoFrameTitle" : "panelCanvasTitle");
    await openPanelForSource(createCapturedSource(dataUrl, title));
    return;
  }

  if (srcUrl) {
    await openPanelForSource(createUrlSource(srcUrl));
    return;
  }

  showToast(t("contextNoImageFound"));
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
  // Hide the panel while selecting so the page looks exactly like the
  // screenshot will, instead of the panel covering part of it.
  const restoreUi = hideOwnUiForCapture([panel, hoverTrigger]);

  const overlay = document.createElement("div");
  overlay.id = "pg-region-overlay";
  overlay.lang = getTranslator().messages.htmlLang;
  overlay.innerHTML = `
    <div class="pg-region-hint">${escapeHtml(t("regionSelectHint"))}</div>
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
    // captureViewportRegion hides the panel again in the same task, so it is
    // not painted in between.
    restoreUi();
    if (!selected) return;

    try {
      const dataUrl = await captureViewportRegion({
        ...selected,
        devicePixelRatio: window.devicePixelRatio || 1
      });
      await openPanelForSource(createCapturedSource(dataUrl, t("panelRegionTitle")));
    } catch (error) {
      showToast(error.message || t("regionCaptureFailed"));
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
    throw new Error(t("regionOutOfView"));
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

function hideOwnUiForCapture(elements = [panel, hoverTrigger, toast]) {
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
