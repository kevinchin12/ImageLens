const imageCache = new Map();
const RATIO_OPTIONS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const DEFAULT_TRANSLATOR = globalThis.ImageLensI18n.createTranslator("auto");

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
hoverTrigger.title = DEFAULT_TRANSLATOR.t("panelHoverTitle");

const panel = document.createElement("aside");
panel.id = "pg-panel";
panel.innerHTML = `
  <div class="pg-shell">
    <div class="pg-header">
      <div class="pg-title">
        <strong id="pg-brand">${escapeHtml(DEFAULT_TRANSLATOR.t("appName"))}</strong>
      </div>
      <div class="pg-header-actions">
        <button class="pg-icon-button" id="pg-open-options" type="button" aria-label="${escapeHtml(DEFAULT_TRANSLATOR.t("panelOpenSettings"))}" title="${escapeHtml(DEFAULT_TRANSLATOR.t("panelOpenSettings"))}">⚙</button>
        <button class="pg-close" id="pg-close" type="button">${escapeHtml(DEFAULT_TRANSLATOR.t("panelClose"))}</button>
      </div>
    </div>

    <div class="pg-row">
      <div class="pg-preview"><img id="pg-preview-image" alt="selected image preview" /></div>
      <div class="pg-title">
        <strong id="pg-image-title">${escapeHtml(DEFAULT_TRANSLATOR.t("panelCurrentImage"))}</strong>
        <span id="pg-image-url">${escapeHtml(DEFAULT_TRANSLATOR.t("panelWaitingImage"))}</span>
      </div>
    </div>

    <section class="pg-section pg-section-prompt">
      <div class="pg-section-head">
        <strong id="pg-prompt-heading">${escapeHtml(DEFAULT_TRANSLATOR.t("panelPromptTitle"))}</strong>
        <div class="pg-chip-group">
          <button class="pg-chip" id="pg-detail-short" type="button">${escapeHtml(DEFAULT_TRANSLATOR.t("panelShort"))}</button>
          <button class="pg-chip is-active" id="pg-detail-full" type="button">${escapeHtml(DEFAULT_TRANSLATOR.t("panelFull"))}</button>
          <button class="pg-chip" id="pg-toggle-translation" type="button">${escapeHtml(DEFAULT_TRANSLATOR.t("panelViewChinese"))}</button>
          <button class="pg-chip" id="pg-toggle-structure" type="button">${escapeHtml(DEFAULT_TRANSLATOR.t("panelShowStructure"))}</button>
        </div>
      </div>

      <textarea class="pg-textarea" id="pg-prompt-input" placeholder="${escapeHtml(DEFAULT_TRANSLATOR.t("panelPromptPlaceholder"))}"></textarea>
      <div class="pg-structure pg-hidden" id="pg-structure">
        <div class="pg-structure-grid" id="pg-structure-grid"></div>
      </div>
      <div class="pg-meta">
        <span id="pg-status">${escapeHtml(DEFAULT_TRANSLATOR.t("panelReady"))}</span>
        <span id="pg-char-count">${escapeHtml(DEFAULT_TRANSLATOR.t("panelChars", { count: 0 }))}</span>
      </div>

      <div class="pg-actions pg-actions-fixed">
        <button class="pg-action pg-fixed-control" id="pg-copy" type="button">${escapeHtml(DEFAULT_TRANSLATOR.t("panelCopy"))}</button>
        <button class="pg-action pg-fixed-control" id="pg-analyze" type="button">${escapeHtml(DEFAULT_TRANSLATOR.t("panelReanalyze"))}</button>
      </div>
    </section>

    <section class="pg-section" id="pg-generate-section">
      <div class="pg-section-head">
        <strong id="pg-generate-heading">${escapeHtml(DEFAULT_TRANSLATOR.t("panelGenerateTitle"))}</strong>
      </div>

      <div class="pg-generate-row">
        <label class="pg-select-wrap pg-fixed-control-wrap">
          <span id="pg-ratio-label">${escapeHtml(DEFAULT_TRANSLATOR.t("panelAspectRatio"))}</span>
          <select class="pg-select pg-fixed-control" id="pg-ratio-select"></select>
        </label>
        <div class="pg-actions pg-actions-fixed">
          <button class="pg-action primary pg-fixed-control" id="pg-generate" type="button">${escapeHtml(DEFAULT_TRANSLATOR.t("panelGenerate"))}</button>
        </div>
      </div>

      <div class="pg-inline-preview" id="pg-inline-preview">
        <div class="pg-inline-stack" id="pg-inline-grid"></div>
      </div>
    </section>

    <p class="pg-credit" id="pg-credit">${escapeHtml(DEFAULT_TRANSLATOR.t("panelCredit"))}</p>
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
  toggleStructure: panel.querySelector("#pg-toggle-structure"),
  structure: panel.querySelector("#pg-structure"),
  structureGrid: panel.querySelector("#pg-structure-grid"),
  generateSection: panel.querySelector("#pg-generate-section"),
  ratioSelect: panel.querySelector("#pg-ratio-select"),
  inlinePreview: panel.querySelector("#pg-inline-preview"),
  inlineGrid: panel.querySelector("#pg-inline-grid")
};

init();

async function init() {
  const response = await sendMessage({ type: "get-settings" });
  state.settings = response;
  state.panelData.detail = "full";
  state.panelData.language = "en";
  state.panelData.aspectRatio = state.settings.aspectRatio || "1:1";
  renderRatioSelect();
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
    structuredPrompt: null,
    analysis: null,
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
  hoverTrigger.title = translator.t("panelHoverTitle");
  panel.querySelector("#pg-brand").textContent = translator.t("appName");
  els.openOptions.setAttribute("aria-label", translator.t("panelOpenSettings"));
  els.openOptions.title = translator.t("panelOpenSettings");
  els.close.textContent = translator.t("panelClose");
  panel.querySelector("#pg-prompt-heading").textContent = translator.t("panelPromptTitle");
  els.detailShort.textContent = translator.t("panelShort");
  els.detailFull.textContent = translator.t("panelFull");
  els.input.placeholder = translator.t("panelPromptPlaceholder");
  els.copy.textContent = translator.t("panelCopy");
  els.analyze.textContent = translator.t("panelReanalyze");
  panel.querySelector("#pg-generate-heading").textContent = translator.t("panelGenerateTitle");
  panel.querySelector("#pg-ratio-label").textContent = translator.t("panelAspectRatio");
  els.generate.textContent = translator.t("panelGenerate");
  panel.querySelector("#pg-credit").textContent = translator.t("panelCredit");
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
  els.toggleStructure.addEventListener("click", toggleStructureView);
  els.analyze.addEventListener("click", () => analyzeCurrentImage({ force: true }));

  els.ratioSelect.addEventListener("change", () => {
    state.panelData.aspectRatio = els.ratioSelect.value;
    persistPanelImageCache();
    setStatus(t("panelRatioChanged", { ratio: state.panelData.aspectRatio }));
  });

  els.copy.addEventListener("click", async () => {
    const text = getCurrentPrompt().trim();
    if (!text) {
      setStatus(t("panelNoPromptToCopy"), "error");
      return;
    }
    await navigator.clipboard.writeText(text);
    setStatus(t("panelPromptCopied"), "success");
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
      setStatus(error.message || t("panelOpenViewerFailed"), "error");
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
  state.settings = await sendMessage({ type: "get-settings" });
  applyStaticTranslations();
  state.panelImage = image;
  state.panelOpen = true;
  panel.classList.add("pg-open");

  const imageUrl = image.currentSrc || image.src;
  els.previewImage.src = imageUrl;
  els.imageTitle.textContent = image.alt?.trim() || t("panelWebImage");
  els.imageUrl.textContent = truncateMiddle(imageUrl, 52);
  state.currentJob = null;
  renderInlineImages([]);

  const cached = imageCache.get(imageUrl);
  if (cached) {
    hydratePanelData(cached);
    return;
  }

  state.panelData = createEmptyPanelData();
  state.panelData.detail = "full";
  state.panelData.language = "en";
  state.panelData.aspectRatio = state.settings?.aspectRatio || "1:1";
  renderRatioSelect();
  syncGenerationVisibility();
  syncPromptControls();
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
  if (!state.panelImage) return;

  const imageUrl = state.panelImage.currentSrc || state.panelImage.src;
  if (!imageUrl) return;

  if (!force && imageCache.has(imageUrl)) {
    hydratePanelData(imageCache.get(imageUrl));
    return;
  }

  await runAction("analyze", t("panelAnalyzing"), async () => {
    const imageDataUrl = await captureImageDataUrl(state.panelImage);
    const screenshotCrop = getImageViewportCrop(state.panelImage);
    const result = await sendMessage({
      type: "analyze-image",
      payload: {
        imageUrl,
        imageDataUrl,
        screenshotCrop,
        pageUrl: location.href,
        alt: state.panelImage.alt || ""
      }
    });

    const cached = {
      title: result.title || t("panelPromptTitleFallback"),
      detail: state.panelData.detail || "full",
      language: "en",
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

    imageCache.set(imageUrl, cached);
    hydratePanelData(cached);
  });
}

function switchDetail(detail) {
  state.panelData.detail = detail;
  syncPromptControls();
}

function togglePromptLanguage() {
  if (!state.settings?.enableChineseRecognition) {
    state.panelData.language = "en";
    syncPromptControls();
    return;
  }

  const current = state.panelData.language || "en";
  state.panelData.language = current === "en" ? "zh" : "en";
  syncPromptControls();
  renderStructureView();
  persistPanelImageCache();
}

function hydratePanelData(data) {
  const preferredLanguage = data.language || data.languageByDetail?.[data.detail || "full"] || "en";
  state.panelData = {
    title: data.title || t("panelPromptTitleFallback"),
    detail: data.detail || "full",
    language: state.settings?.enableChineseRecognition ? preferredLanguage : "en",
    aspectRatio: data.aspectRatio || state.settings?.aspectRatio || "1:1",
    structuredPrompt: data.structuredPrompt || null,
    analysis: data.analysis || null,
    structureOpen: Boolean(data.structureOpen),
    prompts: {
      short: normalizePromptPair(data.prompts?.short),
      full: normalizePromptPair(data.prompts?.full)
    }
  };

  els.imageTitle.textContent = state.panelData.title || t("panelPromptTitleFallback");
  renderRatioSelect();
  syncGenerationVisibility();
  syncPromptControls();
  renderStructureView();
  setStatus(t("panelAnalyzeDone"), "success");
}

function syncPromptControls() {
  els.detailShort.classList.toggle("is-active", state.panelData.detail === "short");
  els.detailFull.classList.toggle("is-active", state.panelData.detail === "full");
  els.toggleTranslation.hidden = !state.settings?.enableChineseRecognition;
  els.toggleTranslation.textContent = getCurrentLanguage() === "zh" ? t("panelViewEnglish") : t("panelViewChinese");
  els.toggleStructure.textContent = state.panelData.structureOpen ? t("panelHideStructure") : t("panelShowStructure");
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
  const visible = state.panelData.structureOpen && entries.length > 0;
  els.structure.classList.toggle("pg-hidden", !visible);
  els.structureGrid.dataset.uiLanguage = getTranslator().language;

  if (!visible) {
    els.structureGrid.innerHTML = "";
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

  if (/^subject|主体/.test(normalized)) return "subject";
  if (/^style|风格/.test(normalized)) return "style";
  if (/^lighting|光线|光影/.test(normalized)) return "lighting";
  if (/^camera|镜头/.test(normalized)) return "camera";
  if (/^environment|环境/.test(normalized)) return "environment";
  if (/^material|材质/.test(normalized)) return "material";
  if (/^composition|构图/.test(normalized)) return "composition";
  if (/^rendering|渲染/.test(normalized)) return "rendering";
  return "";
}

function orderStructureEntries(entries) {
  const labelOrder = ["subject", "style", "lighting", "camera", "environment", "material", "composition", "rendering"];
  const entryMap = new Map();

  for (const entry of entries) {
    if (!entryMap.has(entry.label)) entryMap.set(entry.label, entry);
  }

  return labelOrder.map((label) => entryMap.get(label)).filter(Boolean);
}

function entriesHaveChinese(entries) {
  return entries.some((entry) => /[\u4e00-\u9fff]/.test(entry.value));
}

function getStructureLabel(key) {
  const labelMap = {
    subject: "structureSubject",
    style: "structureStyle",
    lighting: "structureLighting",
    camera: "structureCamera",
    environment: "structureEnvironment",
    material: "structureMaterial",
    composition: "structureComposition",
    rendering: "structureRendering"
  };

  return t(labelMap[key] || key);
}

function buildStructureEntriesFromAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") return [];

  const rows = [
    ["subject", joinValues([analysis.subject?.main, ...(analysis.subject?.attributes || []), analysis.subject?.action])],
    ["style", joinValues([analysis.style?.medium, analysis.style?.genre, analysis.style?.mood, analysis.style?.referenceLook])],
    ["lighting", joinValues([analysis.lighting?.direction, analysis.lighting?.quality, analysis.lighting?.effect, analysis.lighting?.timeOfDay])],
    ["camera", joinValues([analysis.camera?.focalLength, analysis.camera?.aperture, analysis.camera?.angle, analysis.camera?.shotType, analysis.camera?.depthOfField])],
    ["environment", joinValues([analysis.environment?.sceneType, analysis.environment?.backgroundMaterial, analysis.environment?.spatialRelation])],
    ["material", joinValues([analysis.material?.surface, analysis.material?.microDetail, ...(analysis.material?.opticalProperties || [])])],
    ["composition", joinValues([analysis.composition?.layout, analysis.composition?.subjectPlacement, analysis.composition?.foreground, analysis.composition?.background, analysis.composition?.leadingLines, analysis.composition?.symmetry])],
    ["rendering", joinValues([analysis.rendering?.colorGrade, ...(analysis.rendering?.deviceLook || []), ...(analysis.rendering?.priorityTerms || [])])]
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

function getImageViewportCrop(image) {
  if (!(image instanceof HTMLImageElement)) return null;

  const rect = image.getBoundingClientRect();
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

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension request failed.");
  }
  return response.data;
}
