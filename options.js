const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const docButton = document.getElementById("open-doc");
const imageGenerationEnabledField = document.querySelector('[name="imageGenerationEnabled"]');
const imageSettingsGroup = document.getElementById("image-settings-group");
const uiLanguageField = document.querySelector('[name="uiLanguage"]');
const donationWidgetSlot = document.getElementById("donation-widget-slot");

let currentSettings = null;
let currentLanguagePreference = uiLanguageField?.value || "auto";

init();

async function init() {
  renderLanguageChoices();
  applyLanguage(currentLanguagePreference);

  uiLanguageField?.addEventListener("change", handleLanguagePreferenceChange);
  imageGenerationEnabledField?.addEventListener("change", syncImageSettingsVisibility);

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

  const formData = new FormData(form);
  const payload = {
    provider: "gemini",
    apiMode: "direct",
    uiLanguage: uiLanguageField?.value || formData.get("uiLanguage") || "auto",
    promptApiKey: formData.get("promptApiKey"),
    promptModel: formData.get("promptModel"),
    imageGenerationEnabled: getField("imageGenerationEnabled")?.checked || false,
    imageApiKey: formData.get("imageApiKey"),
    imageModel: formData.get("imageModel"),
    customProxyUrl: "",
    customProxyToken: "",
    autoAnalyze: getField("autoAnalyze")?.checked || false,
    enableChineseRecognition: getField("enableChineseRecognition")?.checked || false
  };

  currentLanguagePreference = payload.uiLanguage;
  applyLanguage(currentLanguagePreference);

  try {
    statusEl.textContent = t("statusSaving");
    const saved = await sendMessage({ type: "save-settings", payload });
    currentSettings = saved;
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

function hydrateForm(settings) {
  for (const [key, value] of Object.entries(settings)) {
    const field = getField(key);
    if (!field) continue;

    if (field.type === "checkbox") {
      field.checked = Boolean(value);
      continue;
    }

    field.value = value;
  }

  renderLanguageChoices();
  syncImageSettingsVisibility();
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

function applyLanguage(preference) {
  const translator = globalThis.ImageLensI18n.createTranslator(preference);
  document.documentElement.lang = translator.messages.htmlLang;
  document.title = translator.t("optionsTitle");

  setText("hero-eyebrow", translator.t("heroEyebrow"));
  setText("hero-title", translator.t("heroTitle"));
  setText("hero-subtitle", translator.t("heroSubtitle"));
  setText("ui-language-section-title", translator.t("languageLabel"));
  setText("ui-language-section-description", translator.t("languageSectionDescription"));
  setText("analyze-section-title", translator.t("analyzeSectionTitle"));
  setText("analyze-section-description", translator.t("analyzeSectionDescription"));
  setText("ui-language-label", translator.t("languageLabel"));
  setText("prompt-api-key-label", translator.t("promptApiKeyLabel"));
  setText("local-storage-note", translator.t("localStorageNote"));
  setText("prompt-model-label", translator.t("promptModelLabel"));
  setText("auto-analyze-label", translator.t("autoAnalyzeLabel"));
  setText("enable-chinese-recognition-label", translator.t("enableChineseRecognitionLabel"));
  setText("generate-section-title", translator.t("generateSectionTitle"));
  setText("generate-section-description", translator.t("generateSectionDescription"));
  setText("image-generation-enabled-label", translator.t("imageGenerationEnabledLabel"));
  setText("image-api-key-label", translator.t("imageApiKeyLabel"));
  setText("same-key-note", translator.t("sameKeyNote"));
  setText("image-model-label", translator.t("imageModelLabel"));
  setText("image-model-help", translator.t("imageModelHelp"));
  setText("save-button", translator.t("saveButton"));
  setText("open-doc", translator.t("docsButton"));
  setText("options-note", translator.t("optionsNote"));

  setPlaceholder(
    "promptApiKey",
    translator.language === "zh" ? "请填入你的 Gemini API Key" : "Enter your Gemini API key"
  );
  setPlaceholder("promptModel", translator.t("promptModelPlaceholder"));
  setPlaceholder(
    "imageApiKey",
    translator.language === "zh" ? "请填入你的 Gemini API Key" : "Enter your Gemini API key"
  );
  setPlaceholder("imageModel", translator.t("imageModelPlaceholder"));

  renderLanguageChoices();
  renderDonationWidget(translator);
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
  if (chrome?.tabs?.create) {
    chrome.tabs.create({
      url: "https://ai.google.dev/gemini-api/docs/image-generation"
    });
    return;
  }

  window.open("https://ai.google.dev/gemini-api/docs/image-generation", "_blank", "noopener");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setPlaceholder(name, value) {
  const field = getField(name);
  if (field) field.placeholder = value;
}

function getField(name) {
  return document.querySelector(`[name="${CSS.escape(name)}"]`);
}

function syncImageSettingsVisibility() {
  const enabled = Boolean(imageGenerationEnabledField?.checked);
  imageSettingsGroup?.classList.toggle("is-hidden", !enabled);
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
