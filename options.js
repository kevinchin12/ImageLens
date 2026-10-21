const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const docButton = document.getElementById("open-doc");
const promptProviderField = document.querySelector('[name="promptProvider"]');
const imageProviderField = document.querySelector('[name="imageProvider"]');
const imageGenerationEnabledField = document.querySelector('[name="imageGenerationEnabled"]');
const imageSettingsGroup = document.getElementById("image-settings-group");
const uiLanguageField = document.querySelector('[name="uiLanguage"]');
const donationWidgetSlot = document.getElementById("donation-widget-slot");
const promptModelHelp = document.getElementById("prompt-model-help");
const imageModelHelp = document.getElementById("image-model-help");
const promptBaseUrlHelp = document.getElementById("prompt-base-url-help");
const imageBaseUrlHelp = document.getElementById("image-base-url-help");

const PROVIDER_DOCS = {
  gemini: "https://ai.google.dev/gemini-api/docs/image-generation",
  "openai-compatible": "https://developers.openai.com/api/docs"
};

const SECTIONS = ["analyze", "generate", "general", "about"];
const PROVIDER_FIELD_NAMES = ["promptProvider", "imageProvider"];
// Text fields save after typing pauses; switches and selects save right away.
const TYPING_SAVE_DELAY = 600;

let currentSettings = null;
let currentLanguagePreference = uiLanguageField?.value || "auto";
let promptProfileDrafts = {};
let imageProfileDrafts = {};
let saveTimer = null;

init();

async function init() {
  renderLanguageChoices();
  renderProviderChoices();
  applyLanguage(currentLanguagePreference);
  showSection(getSectionFromHash());
  showVersion();

  uiLanguageField?.addEventListener("change", handleLanguagePreferenceChange);
  imageGenerationEnabledField?.addEventListener("change", syncImageSettingsVisibility);
  promptProviderField?.addEventListener("change", handlePromptProviderChange);
  imageProviderField?.addEventListener("change", handleImageProviderChange);
  form.addEventListener("submit", handleSubmit);
  form.addEventListener("input", handleFormInput);
  form.addEventListener("change", handleFormChange);
  form.addEventListener("click", handleFormClick);
  docButton.addEventListener("click", openDocs);
  for (const item of document.querySelectorAll(".nav-item")) {
    item.addEventListener("click", () => showSection(item.dataset.section));
  }
  window.addEventListener("hashchange", () => showSection(getSectionFromHash()));

  if (!hasExtensionRuntime()) {
    setStandaloneMode();
    return;
  }

  try {
    const settings = await sendMessage({ type: "get-settings" });
    currentSettings = settings;
    currentLanguagePreference = settings.uiLanguage || "auto";
    promptProfileDrafts = cloneProfiles(settings.promptProviderProfiles);
    imageProfileDrafts = cloneProfiles(settings.imageProviderProfiles);
    hydrateForm(settings);
    applyLanguage(currentLanguagePreference);
    setStatus("");
  } catch (error) {
    setStatus(error.message || t("statusLoadFailed"), "error");
  }
}

function getSectionFromHash() {
  const section = location.hash.replace(/^#/, "");
  return SECTIONS.includes(section) ? section : SECTIONS[0];
}

function showSection(section) {
  for (const element of document.querySelectorAll(".section")) {
    element.classList.toggle("is-active", element.dataset.section === section);
  }
  for (const item of document.querySelectorAll(".nav-item")) {
    const active = item.dataset.section === section;
    item.classList.toggle("is-active", active);
    if (active) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  }
  if (location.hash.replace(/^#/, "") !== section) {
    history.replaceState(null, "", `#${section}`);
  }
}

function showVersion() {
  const version = globalThis.chrome?.runtime?.getManifest?.()?.version;
  if (version) setText("about-version", version);
}

function handleFormInput(event) {
  if (event.target.matches('input[type="text"], input[type="url"], input[type="password"]')) {
    scheduleSave(TYPING_SAVE_DELAY);
  }
}

function handleFormChange(event) {
  // Provider changes save through their own handlers, which first store the
  // previous provider's values.
  if (PROVIDER_FIELD_NAMES.includes(event.target.name)) return;
  scheduleSave(event.target.matches('input[type="checkbox"], select') ? 0 : TYPING_SAVE_DELAY);
}

function handleFormClick(event) {
  const providerOption = event.target.closest(".provider-option");
  if (providerOption) {
    const field = getField(providerOption.closest(".provider-picker").dataset.target);
    if (field && field.value !== providerOption.dataset.value) {
      field.value = providerOption.dataset.value;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }

  const keyToggle = event.target.closest(".key-toggle");
  if (keyToggle) {
    event.preventDefault();
    const input = getField(keyToggle.dataset.keyFor);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
    syncKeyToggles();
  }
}

function scheduleSave(delay) {
  if (!hasExtensionRuntime()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveSettings();
  }, delay);
}

// Saves right away if a save is waiting, using the given providers instead of
// what the provider fields show now.
async function flushPendingSave(overrides) {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await saveSettings(overrides);
}

async function handleSubmit(event) {
  event.preventDefault();
  clearTimeout(saveTimer);
  saveTimer = null;
  await saveSettings();
}

async function saveSettings(overrides = {}) {
  if (!hasExtensionRuntime()) {
    setStatus(t("statusOpenExtension"), "error");
    return;
  }

  const promptProvider = overrides.promptProvider || promptProviderField?.value || "gemini";
  const imageProvider = overrides.imageProvider || imageProviderField?.value || "gemini";
  updatePromptDraftFromForm(promptProvider);
  updateImageDraftFromForm(imageProvider);

  const formData = new FormData(form);
  const payload = {
    provider: promptProvider,
    promptProvider,
    imageProvider,
    apiMode: "direct",
    uiLanguage: uiLanguageField?.value || formData.get("uiLanguage") || "auto",
    promptApiKey: String(formData.get("promptApiKey") || ""),
    promptModel: String(formData.get("promptModel") || ""),
    promptBaseUrl: String(formData.get("promptBaseUrl") || ""),
    autoAnalyze: getField("autoAnalyze")?.checked || false,
    enableChineseRecognition: getField("enableChineseRecognition")?.checked || false,
    imageGenerationEnabled: getField("imageGenerationEnabled")?.checked || false,
    imageApiKey: String(formData.get("imageApiKey") || ""),
    imageModel: String(formData.get("imageModel") || ""),
    imageBaseUrl: String(formData.get("imageBaseUrl") || ""),
    customProxyUrl: "",
    customProxyToken: ""
  };

  try {
    setStatus(t("statusSaving"));
    const saved = await sendMessage({ type: "save-settings", payload });
    // Keep the form as typed: re-filling it here would undo keystrokes made
    // while the save was in flight.
    currentSettings = {
      ...saved,
      promptProvider: promptProviderField?.value || saved.promptProvider,
      imageProvider: imageProviderField?.value || saved.imageProvider
    };
    setStatus(t("statusSaved"));
  } catch (error) {
    setStatus(error.message || t("statusSaveFailed"), "error");
  }
}

function setStatus(text, tone = "") {
  statusEl.textContent = text;
  if (tone) {
    statusEl.dataset.tone = tone;
  } else {
    delete statusEl.dataset.tone;
  }
}

function handleLanguagePreferenceChange() {
  currentLanguagePreference = uiLanguageField?.value || "auto";
  applyLanguage(currentLanguagePreference);
}

async function handlePromptProviderChange() {
  const previousProvider = currentSettings?.promptProvider || "gemini";
  updatePromptDraftFromForm(previousProvider);
  await flushPendingSave({ promptProvider: previousProvider });
  const provider = promptProviderField?.value || "gemini";
  currentSettings = {
    ...(currentSettings || {}),
    promptProvider: provider,
    provider
  };
  hydratePromptFields(provider, promptProfileDrafts[provider] || {});
  renderProviderChoices();
  syncDocsButton(provider);
  scheduleSave(0);
}

async function handleImageProviderChange() {
  const previousProvider = currentSettings?.imageProvider || "gemini";
  updateImageDraftFromForm(previousProvider);
  await flushPendingSave({ imageProvider: previousProvider });
  const provider = imageProviderField?.value || "gemini";
  currentSettings = {
    ...(currentSettings || {}),
    imageProvider: provider
  };
  hydrateImageFields(provider, imageProfileDrafts[provider] || {});
  renderProviderChoices();
  scheduleSave(0);
}

function hydrateForm(settings) {
  currentSettings = settings;
  currentLanguagePreference = settings.uiLanguage || currentLanguagePreference || "auto";

  setFieldValue("uiLanguage", currentLanguagePreference);
  setFieldValue("promptProvider", settings.promptProvider || "gemini");
  setFieldValue("imageProvider", settings.imageProvider || "gemini");
  setCheckboxValue("enableChineseRecognition", settings.enableChineseRecognition);

  hydratePromptFields(
    settings.promptProvider || "gemini",
    settings.promptProviderProfiles?.[settings.promptProvider || "gemini"] || {
      apiKey: settings.promptApiKey,
      model: settings.promptModel,
      baseUrl: settings.promptBaseUrl,
      autoAnalyze: settings.autoAnalyze
    }
  );
  hydrateImageFields(
    settings.imageProvider || "gemini",
    settings.imageProviderProfiles?.[settings.imageProvider || "gemini"] || {
      imageGenerationEnabled: settings.imageGenerationEnabled,
      apiKey: settings.imageApiKey,
      model: settings.imageModel,
      baseUrl: settings.imageBaseUrl
    }
  );

  renderLanguageChoices();
  renderProviderChoices();
  syncImageSettingsVisibility();
  syncDocsButton(settings.promptProvider || "gemini");
}

function hydratePromptFields(provider, source) {
  const merged = normalizePromptProfile(provider, source);
  setFieldValue("promptProvider", provider);
  setFieldValue("promptApiKey", merged.apiKey);
  setFieldValue("promptModel", merged.model);
  setFieldValue("promptBaseUrl", merged.baseUrl);
  setCheckboxValue("autoAnalyze", merged.autoAnalyze);
  syncPromptProviderUI(provider);
}

function hydrateImageFields(provider, source) {
  const merged = normalizeImageProfile(provider, source);
  setFieldValue("imageProvider", provider);
  setCheckboxValue("imageGenerationEnabled", merged.imageGenerationEnabled);
  setFieldValue("imageApiKey", merged.apiKey);
  setFieldValue("imageModel", merged.model);
  setFieldValue("imageBaseUrl", merged.baseUrl);
  syncImageProviderUI(provider);
  syncImageSettingsVisibility();
}

function updatePromptDraftFromForm(provider = promptProviderField?.value || "gemini") {
  promptProfileDrafts[provider] = normalizePromptProfile(provider, {
    apiKey: getField("promptApiKey")?.value || "",
    model: getField("promptModel")?.value || "",
    baseUrl: getField("promptBaseUrl")?.value || "",
    autoAnalyze: getField("autoAnalyze")?.checked || false
  });
}

function updateImageDraftFromForm(provider = imageProviderField?.value || "gemini") {
  imageProfileDrafts[provider] = normalizeImageProfile(provider, {
    imageGenerationEnabled: getField("imageGenerationEnabled")?.checked || false,
    apiKey: getField("imageApiKey")?.value || "",
    model: getField("imageModel")?.value || "",
    baseUrl: getField("imageBaseUrl")?.value || ""
  });
}

function renderLanguageChoices() {
  if (!uiLanguageField) return;

  const current = uiLanguageField.value || currentLanguagePreference || "auto";
  uiLanguageField.innerHTML = [
    { value: "auto", label: t("languageAuto") },
    { value: "zh", label: t("languageZh") },
    { value: "en", label: t("languageEn") }
  ]
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  uiLanguageField.value = current;
}

function renderProviderChoices() {
  renderProviderSelect(promptProviderField, promptProviderField?.value || currentSettings?.promptProvider || "gemini");
  renderProviderSelect(imageProviderField, imageProviderField?.value || currentSettings?.imageProvider || "gemini");
}

function renderProviderSelect(field, current) {
  if (!field) return;

  const providers = [
    { value: "gemini", label: t("providerGemini"), hint: t("providerGeminiHint") },
    { value: "openai-compatible", label: t("providerOpenAICompatible"), hint: t("providerOpenAICompatibleHint") }
  ];
  field.innerHTML = providers
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  field.value = current;

  // The hidden select stays the source of truth; the cards just set it.
  const picker = document.querySelector(`.provider-picker[data-target="${field.name}"]`);
  if (!picker) return;
  picker.innerHTML = providers
    .map((option) => {
      const active = option.value === current;
      return `
        <button class="provider-option${active ? " is-active" : ""}" data-value="${option.value}" type="button" role="radio" aria-checked="${active}"${field.disabled ? " disabled" : ""}>
          <strong>${option.label}</strong>
          <span>${option.hint}</span>
        </button>
      `;
    })
    .join("");
}

function syncKeyToggles() {
  for (const toggle of document.querySelectorAll(".key-toggle")) {
    const input = getField(toggle.dataset.keyFor);
    const visible = input?.type === "text";
    toggle.textContent = visible ? t("hideKey") : t("showKey");
    toggle.setAttribute("aria-pressed", String(visible));
  }
}

function applyLanguage(preference) {
  const translator = globalThis.ImageLensI18n.createTranslator(preference);
  document.documentElement.lang = translator.messages.htmlLang;
  document.title = translator.t("optionsTitle");

  setText("brand-name", translator.t("appName"));
  setText("nav-analyze", translator.t("navAnalyze"));
  setText("nav-generate", translator.t("navGenerate"));
  setText("nav-general", translator.t("navGeneral"));
  setText("nav-about", translator.t("navAbout"));
  setText("hero-subtitle", translator.t("heroSubtitle"));
  setText("general-section-title", translator.t("navGeneral"));
  setText("about-section-title", translator.t("navAbout"));
  setText("about-version-label", translator.t("aboutVersion"));
  setText("about-links-label", translator.t("aboutLinks"));
  setText("about-store", translator.t("aboutStore"));
  setText("about-privacy", translator.t("aboutPrivacy"));
  setText("about-credit", translator.t("panelCredit"));
  setText("ui-language-section-description", translator.t("languageSectionDescription"));
  setText("ui-language-label", translator.t("languageLabel"));
  setText("analyze-section-title", translator.t("analyzeSectionTitle"));
  setText("analyze-section-description", translator.t("analyzeSectionDescription"));
  setText("prompt-provider-label", translator.t("promptProviderLabel"));
  setText("prompt-base-url-label", translator.t("promptBaseUrlLabel"));
  setText("prompt-api-key-label", getPromptApiKeyLabel(promptProviderField?.value || "gemini", translator));
  setText("local-storage-note", translator.t("localStorageNote"));
  setText("prompt-model-label", translator.t("promptModelLabel"));
  setText("auto-analyze-label", translator.t("autoAnalyzeLabel"));
  setText("enable-chinese-recognition-label", translator.t("enableChineseRecognitionLabel"));
  setText("generate-section-title", translator.t("generateSectionTitle"));
  setText("generate-section-description", translator.t("generateSectionDescription"));
  setText("image-generation-enabled-label", translator.t("imageGenerationEnabledLabel"));
  setText("image-provider-label", translator.t("imageProviderLabel"));
  setText("image-base-url-label", translator.t("imageBaseUrlLabel"));
  setText("image-api-key-label", getImageApiKeyLabel(imageProviderField?.value || "gemini", translator));
  setText("same-key-note", translator.t("sameKeyNote"));
  setText("image-model-label", translator.t("imageModelLabel"));
  setText("open-doc", translator.t("docsButton"));
  setText("options-note", translator.t("optionsNote"));

  setPlaceholder(
    "promptApiKey",
    translator.language === "zh" ? "请填入对应服务商的 API Key" : "Enter the provider API key"
  );
  setPlaceholder("promptBaseUrl", getProviderBaseUrlPlaceholder(promptProviderField?.value || "gemini"));
  setPlaceholder("promptModel", getPromptModelPlaceholder(promptProviderField?.value || "gemini"));
  setPlaceholder(
    "imageApiKey",
    translator.language === "zh" ? "请填入对应服务商的 API Key" : "Enter the provider API key"
  );
  setPlaceholder("imageBaseUrl", getProviderBaseUrlPlaceholder(imageProviderField?.value || "gemini"));
  setPlaceholder("imageModel", getImageModelPlaceholder(imageProviderField?.value || "gemini"));

  renderLanguageChoices();
  renderProviderChoices();
  syncPromptProviderUI(promptProviderField?.value || "gemini");
  syncImageProviderUI(imageProviderField?.value || "gemini");
  syncKeyToggles();
  renderDonationWidget(translator);
}

function syncPromptProviderUI(provider) {
  const translator = globalThis.ImageLensI18n.createTranslator(currentLanguagePreference);
  setText("prompt-api-key-label", getPromptApiKeyLabel(provider, translator));
  setPlaceholder("promptBaseUrl", getProviderBaseUrlPlaceholder(provider));
  setPlaceholder("promptModel", getPromptModelPlaceholder(provider));
  if (promptBaseUrlHelp) {
    promptBaseUrlHelp.textContent =
      provider === "openai-compatible"
        ? translator.t("promptBaseUrlHelpOpenAICompatible")
        : translator.t("promptBaseUrlHelpGemini");
  }
  if (promptModelHelp) {
    promptModelHelp.textContent =
      provider === "openai-compatible"
        ? translator.t("promptModelHelpOpenAICompatible")
        : translator.t("promptModelHelpGemini");
  }
}

function syncImageProviderUI(provider) {
  const translator = globalThis.ImageLensI18n.createTranslator(currentLanguagePreference);
  setText("image-api-key-label", getImageApiKeyLabel(provider, translator));
  setPlaceholder("imageBaseUrl", getProviderBaseUrlPlaceholder(provider));
  setPlaceholder("imageModel", getImageModelPlaceholder(provider));
  if (imageBaseUrlHelp) {
    imageBaseUrlHelp.textContent =
      provider === "openai-compatible"
        ? translator.t("imageBaseUrlHelpOpenAICompatible")
        : translator.t("imageBaseUrlHelpGemini");
  }
  if (imageModelHelp) {
    imageModelHelp.textContent =
      provider === "openai-compatible"
        ? translator.t("imageModelHelpOpenAICompatible")
        : translator.t("imageModelHelpGemini");
  }
}

function getPromptApiKeyLabel(provider, translator) {
  const providerName =
    provider === "openai-compatible"
      ? translator.t("providerOpenAICompatible")
      : translator.t("providerGemini");
  return `${providerName} API Key`;
}

function getImageApiKeyLabel(provider, translator) {
  const providerName =
    provider === "openai-compatible"
      ? translator.t("providerOpenAICompatible")
      : translator.t("providerGemini");
  return `${providerName} API Key`;
}

function getPromptModelPlaceholder(provider) {
  return provider === "openai-compatible" ? "gpt-5.5" : "gemini-3.8-flash";
}

function getImageModelPlaceholder(provider) {
  return provider === "openai-compatible" ? "gpt-image-2" : "gemini-nano-banana-2.1";
}

function getProviderBaseUrlPlaceholder(provider) {
  return provider === "openai-compatible"
    ? "https://api.openai.com/v1"
    : "https://generativelanguage.googleapis.com/v1beta";
}

function renderDonationWidget(translator) {
  if (typeof globalThis.createDonationWidget !== "function" || !donationWidgetSlot) {
    return;
  }

  globalThis.createDonationWidget(donationWidgetSlot, {
    title: translator.t("donateTitle"),
    description: translator.t("donateDescription"),
    modalTitle: translator.t("donateModalTitle"),
    modalDescription: translator.t("donateModalDescription"),
    buttonLabel: translator.t("donateButton"),
    closeLabel: translator.t("donateClose"),
    koFiLabel: translator.t("donateKofi"),
    koFiHint: translator.t("donateKofiHint"),
    koFiUrl: "https://ko-fi.com/kevinchin1235",
    chinaLabel: translator.t("donateChina"),
    chinaHint: translator.t("donateChinaHint"),
    qrAlt: translator.t("donateQrAlt"),
    scanHint: translator.t("donateScanHint"),
    placeholderText: translator.t("donatePlaceholder"),
    qrImageUrl: "./assets/wechat-donation-qr.png"
  });
}

function openDocs() {
  const provider = promptProviderField?.value || "gemini";
  const url = PROVIDER_DOCS[provider] || PROVIDER_DOCS.gemini;

  if (chrome?.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }

  window.open(url, "_blank", "noopener");
}

function syncDocsButton(provider) {
  docButton.dataset.provider = provider;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setPlaceholder(name, value) {
  const field = getField(name);
  if (field) field.placeholder = value;
}

function setFieldValue(name, value) {
  const field = getField(name);
  if (field) field.value = value ?? "";
}

function setCheckboxValue(name, value) {
  const field = getField(name);
  if (field) field.checked = Boolean(value);
}

function getField(name) {
  return document.querySelector(`[name="${CSS.escape(name)}"]`);
}

function syncImageSettingsVisibility() {
  const enabled = Boolean(imageGenerationEnabledField?.checked);
  imageSettingsGroup?.classList.toggle("is-hidden", !enabled);
}

function cloneProfiles(value) {
  const source = value && typeof value === "object" ? value : {};
  return JSON.parse(JSON.stringify(source));
}

function getPromptProviderDefaults(provider) {
  if (provider === "openai-compatible") {
    return {
      apiKey: "",
      model: "gpt-5.5",
      baseUrl: "https://api.openai.com/v1",
      autoAnalyze: true
    };
  }

  return {
    apiKey: "",
    model: "gemini-3.8-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    autoAnalyze: true
  };
}

function getImageProviderDefaults(provider) {
  if (provider === "openai-compatible") {
    return {
      imageGenerationEnabled: true,
      apiKey: "",
      model: "gpt-image-2",
      baseUrl: "https://api.openai.com/v1"
    };
  }

  return {
    imageGenerationEnabled: true,
    apiKey: "",
    model: "gemini-nano-banana-2.1",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta"
  };
}

function normalizePromptProfile(provider, source) {
  const defaults = getPromptProviderDefaults(provider);
  const input = source && typeof source === "object" ? source : {};
  return {
    apiKey: String(input.apiKey || ""),
    model: String(input.model || defaults.model),
    baseUrl: String(input.baseUrl || defaults.baseUrl),
    autoAnalyze: "autoAnalyze" in input ? Boolean(input.autoAnalyze) : defaults.autoAnalyze
  };
}

function normalizeImageProfile(provider, source) {
  const defaults = getImageProviderDefaults(provider);
  const input = source && typeof source === "object" ? source : {};
  return {
    imageGenerationEnabled:
      "imageGenerationEnabled" in input
        ? Boolean(input.imageGenerationEnabled)
        : defaults.imageGenerationEnabled,
    apiKey: String(input.apiKey || ""),
    model: String(input.model || defaults.model),
    baseUrl: String(input.baseUrl || defaults.baseUrl)
  };
}

function hasExtensionRuntime() {
  return Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.runtime?.sendMessage);
}

function setStandaloneMode() {
  for (const field of form.querySelectorAll("input, select, .provider-option")) {
    field.disabled = true;
  }
  setStatus(t("statusStandalone"), "error");
}

function t(key, values) {
  return globalThis.ImageLensI18n.createTranslator(currentLanguagePreference).t(key, values);
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Options request failed.");
  }
  return response.data;
}
