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

let currentSettings = null;
let currentLanguagePreference = uiLanguageField?.value || "auto";
let promptProfileDrafts = {};
let imageProfileDrafts = {};

init();

async function init() {
  renderLanguageChoices();
  renderProviderChoices();
  applyLanguage(currentLanguagePreference);

  uiLanguageField?.addEventListener("change", handleLanguagePreferenceChange);
  imageGenerationEnabledField?.addEventListener("change", syncImageSettingsVisibility);
  promptProviderField?.addEventListener("change", handlePromptProviderChange);
  imageProviderField?.addEventListener("change", handleImageProviderChange);
  form.addEventListener("submit", handleSubmit);
  docButton.addEventListener("click", openDocs);

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
    statusEl.textContent = t("statusLoaded");
  } catch (error) {
    statusEl.textContent = error.message || t("statusLoadFailed");
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!hasExtensionRuntime()) {
    statusEl.textContent = t("statusOpenExtension");
    return;
  }

  updatePromptDraftFromForm();
  updateImageDraftFromForm();

  const formData = new FormData(form);
  const payload = {
    provider: promptProviderField?.value || "gemini",
    promptProvider: promptProviderField?.value || "gemini",
    imageProvider: imageProviderField?.value || "gemini",
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

  currentLanguagePreference = payload.uiLanguage;
  applyLanguage(currentLanguagePreference);

  try {
    statusEl.textContent = t("statusSaving");
    const saved = await sendMessage({ type: "save-settings", payload });
    currentSettings = saved;
    promptProfileDrafts = cloneProfiles(saved.promptProviderProfiles);
    imageProfileDrafts = cloneProfiles(saved.imageProviderProfiles);
    hydrateForm(saved);
    applyLanguage(saved.uiLanguage || "auto");
    statusEl.textContent = t("statusSaved");
  } catch (error) {
    statusEl.textContent = error.message || t("statusSaveFailed");
  }
}

function handleLanguagePreferenceChange() {
  currentLanguagePreference = uiLanguageField?.value || "auto";
  applyLanguage(currentLanguagePreference);
}

function handlePromptProviderChange() {
  const previousProvider = currentSettings?.promptProvider || "gemini";
  updatePromptDraftFromForm(previousProvider);
  const provider = promptProviderField?.value || "gemini";
  currentSettings = {
    ...(currentSettings || {}),
    promptProvider: provider,
    provider
  };
  hydratePromptFields(provider, promptProfileDrafts[provider] || {});
  syncDocsButton(provider);
}

function handleImageProviderChange() {
  const previousProvider = currentSettings?.imageProvider || "gemini";
  updateImageDraftFromForm(previousProvider);
  const provider = imageProviderField?.value || "gemini";
  currentSettings = {
    ...(currentSettings || {}),
    imageProvider: provider
  };
  hydrateImageFields(provider, imageProfileDrafts[provider] || {});
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

  field.innerHTML = [
    { value: "gemini", label: t("providerGemini") },
    { value: "openai-compatible", label: t("providerOpenAICompatible") }
  ]
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  field.value = current;
}

function applyLanguage(preference) {
  const translator = globalThis.ImageLensI18n.createTranslator(preference);
  document.documentElement.lang = translator.messages.htmlLang;
  document.title = translator.t("optionsTitle");

  setText("hero-eyebrow", translator.t("heroEyebrow"));
  setText("hero-title", translator.t("heroTitle"));
  setText("hero-subtitle", translator.t("heroSubtitle"));
  setText("ui-language-section-title", translator.t("languageLabel"));
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
  setText("save-button", translator.t("saveButton"));
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
  return translator.language === "zh"
    ? `${providerName} API Key（识图）`
    : `${providerName} API Key for Analysis`;
}

function getImageApiKeyLabel(provider, translator) {
  const providerName =
    provider === "openai-compatible"
      ? translator.t("providerOpenAICompatible")
      : translator.t("providerGemini");
  return translator.language === "zh"
    ? `${providerName} API Key（生图）`
    : `${providerName} API Key for Image Generation`;
}

function getPromptModelPlaceholder(provider) {
  return provider === "openai-compatible" ? "gpt-5.5" : "gemini-3.1-pro-preview";
}

function getImageModelPlaceholder(provider) {
  return provider === "openai-compatible" ? "gpt-image-2" : "gemini-3.1-flash-image-preview";
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
    model: "gemini-3.1-pro-preview",
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
    model: "gemini-3.1-flash-image-preview",
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
  for (const field of form.querySelectorAll("input, select, button[type='submit']")) {
    field.disabled = true;
  }
  statusEl.textContent = t("statusStandalone");
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
