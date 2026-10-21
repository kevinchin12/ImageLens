import "./i18n.js";
import {
  buildAnalysisInstructions,
  buildAnalysisRequestText,
  buildGeminiResponseSchema,
  normalizeAnalysisResult,
  parseLooseJson
} from "./prompt-analysis.js";

const DEFAULT_SETTINGS = {
  provider: "gemini",
  promptProvider: "gemini",
  imageProvider: "gemini",
  apiMode: "direct",
  promptApiKey: "",
  promptModel: "gemini-3.1-pro-preview",
  promptBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  imageGenerationEnabled: true,
  imageApiKey: "",
  imageModel: "gemini-3.1-flash-image-preview",
  imageBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  openaiBaseUrl: "https://api.openai.com/v1",
  geminiApiKey: "",
  geminiTextModel: "gemini-3.1-pro-preview",
  geminiImageModel: "gemini-3.1-flash-image-preview",
  customProxyUrl: "",
  customProxyToken: "",
  uiLanguage: "auto",
  autoAnalyze: true,
  enableChineseRecognition: true,
  aspectRatio: "1:1",
  imageCount: 1,
  providerProfiles: {},
  promptProviderProfiles: {},
  imageProviderProfiles: {}
};
const DEFAULT_PROMPT_MODEL = "gemini-3.1-pro-preview";
const LEGACY_PROMPT_MODEL = "gemini-2.5-flash";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const TEMP_IMAGE_MODEL = "imagen-4.0-generate-001";
const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_DEFAULT_PROMPT_MODEL = "gpt-4.1-mini";
const OPENAI_LATEST_IMAGE_MODEL = "gpt-image-2";
const OPENAI_IMAGE_SIZE_BY_RATIO = {
  "1:1": "1024x1024",
  "3:4": "1024x1536",
  "4:3": "1536x1024",
  "9:16": "1024x1792",
  "16:9": "1792x1024"
};
const SUPPORTED_PROVIDERS = ["gemini", "openai-compatible"];

const VIEWER_DB_NAME = "image-lens-db";
const VIEWER_STORE_NAME = "viewer_payloads";
const VIEWER_RECORD_ID = "current";

const CONTEXT_MENU_ANALYZE_IMAGE = "image-lens-analyze-image";
const CONTEXT_MENU_SELECT_REGION = "image-lens-select-region";
const SELECT_REGION_COMMAND = "select-region";

chrome.runtime.onInstalled.addListener(async () => {
  await setupContextMenus();

  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).filter(([key]) => !(key in existing))
  );
  if (Object.keys(missing).length > 0) {
    await chrome.storage.local.set(missing);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      console.error("[Image Lens]", error);
      sendResponse({ ok: false, error: error.message || "Unknown error" });
    });

  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_SELECT_REGION) {
    sendToTab(tab, { type: "start-region-selection" });
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_ANALYZE_IMAGE) {
    sendToTab(tab, {
      type: "context-analyze-image",
      payload: {
        srcUrl: info.mediaType === "image" ? info.srcUrl || "" : "",
        // The content script only runs in the top frame, so the right-click
        // position it recorded does not apply to clicks inside an iframe.
        inSubframe: Boolean(info.frameId)
      }
    });
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === SELECT_REGION_COMMAND) {
    sendToTab(tab, { type: "start-region-selection" });
  }
});

chrome.action.onClicked.addListener((tab) => {
  sendToTab(tab, { type: "start-region-selection" });
});

// Menu titles follow the UI language setting, so this also runs after the
// settings are saved.
async function setupContextMenus() {
  const { uiLanguage } = await chrome.storage.local.get("uiLanguage");
  const t = getSettingsTranslator({ uiLanguage }).t;

  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ANALYZE_IMAGE,
    title: t("contextMenuAnalyzeImage"),
    contexts: ["page", "image", "link", "video", "frame"]
  });
  chrome.contextMenus.create({
    id: CONTEXT_MENU_SELECT_REGION,
    title: t("contextMenuSelectRegion"),
    contexts: ["page", "image", "link", "video", "frame", "selection"]
  });
}

function sendToTab(tab, message) {
  if (tab?.id === undefined) return;

  chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch((error) => {
    // Pages opened before the extension was installed or updated, and
    // chrome:// pages, have no content script to receive the message.
    console.warn("[Image Lens] Could not reach the page. Reload it and try again.", error);
  });
}

async function handleMessage(message, sender) {
  switch (message.type) {
    case "get-settings":
      return getSettings();
    case "save-settings":
      return saveSettings(message.payload || {});
    case "analyze-image":
      return analyzeImage(message.payload || {}, sender);
    case "capture-region":
      return captureRegion(message.payload || {}, sender);
    case "generate-image":
      return generateImage(message.payload || {});
    case "open-viewer":
      return openViewer(message.payload || {});
    case "open-options":
      return openOptionsPage();
    default:
      throw new Error(`Unsupported message type: ${message.type}`);
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  merged.provider = normalizeProviderName(merged.provider);
  merged.promptProvider = normalizeProviderName(merged.promptProvider || merged.provider);
  merged.imageProvider = normalizeProviderName(merged.imageProvider || merged.provider);

  if (!merged.promptApiKey && merged.geminiApiKey) {
    merged.promptApiKey = merged.geminiApiKey;
  }

  if (!merged.promptModel && merged.geminiTextModel) {
    merged.promptModel = merged.geminiTextModel;
  }

  if (!merged.imageApiKey && merged.geminiApiKey) {
    merged.imageApiKey = merged.geminiApiKey;
  }

  if (!merged.imageModel && merged.geminiImageModel) {
    merged.imageModel = merged.geminiImageModel;
  }
  if (!merged.geminiBaseUrl) {
    merged.geminiBaseUrl = GEMINI_DEFAULT_BASE_URL;
  }
  if (!merged.openaiBaseUrl) {
    merged.openaiBaseUrl = OPENAI_DEFAULT_BASE_URL;
  }
  if (!merged.promptBaseUrl) {
    merged.promptBaseUrl = getProviderBaseUrl(merged.promptProvider);
  }
  if (!merged.imageBaseUrl) {
    merged.imageBaseUrl = getProviderBaseUrl(merged.imageProvider);
  }

  // Migrate the temporary Imagen fallback back to the Gemini Nano Banana 2
  // default, now that image generation uses generateContent.
  const updates = {};
  if (merged.promptModel === LEGACY_PROMPT_MODEL) {
    merged.promptModel = DEFAULT_PROMPT_MODEL;
    updates.promptModel = DEFAULT_PROMPT_MODEL;
  }
  if (merged.geminiTextModel === LEGACY_PROMPT_MODEL) {
    merged.geminiTextModel = DEFAULT_PROMPT_MODEL;
    updates.geminiTextModel = DEFAULT_PROMPT_MODEL;
  }
  if (merged.imageModel === TEMP_IMAGE_MODEL) {
    merged.imageModel = DEFAULT_IMAGE_MODEL;
    updates.imageModel = DEFAULT_IMAGE_MODEL;
  }
  if (merged.geminiImageModel === TEMP_IMAGE_MODEL) {
    merged.geminiImageModel = DEFAULT_IMAGE_MODEL;
    updates.geminiImageModel = DEFAULT_IMAGE_MODEL;
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }

  const providerProfiles = buildProviderProfiles(merged);
  const promptProviderProfiles = buildPromptProviderProfiles(merged, providerProfiles);
  const imageProviderProfiles = buildImageProviderProfiles(merged, providerProfiles);
  repairActiveProviderProfiles(merged, promptProviderProfiles, imageProviderProfiles);
  repairGeminiLegacyProfile(merged, providerProfiles, promptProviderProfiles, imageProviderProfiles);
  const activePromptProfile = promptProviderProfiles[merged.promptProvider];
  const activeImageProfile = imageProviderProfiles[merged.imageProvider];
  const result = {
    ...merged,
    providerProfiles,
    promptProviderProfiles,
    imageProviderProfiles,
    promptApiKey: activePromptProfile.apiKey,
    promptModel: activePromptProfile.model,
    promptBaseUrl: activePromptProfile.baseUrl,
    autoAnalyze: activePromptProfile.autoAnalyze,
    imageGenerationEnabled: activeImageProfile.imageGenerationEnabled,
    imageApiKey: activeImageProfile.apiKey,
    imageModel: activeImageProfile.model,
    imageBaseUrl: activeImageProfile.baseUrl
  };

  result.geminiApiKey = providerProfiles.gemini.promptApiKey || result.geminiApiKey;
  result.geminiTextModel = providerProfiles.gemini.promptModel || result.geminiTextModel;
  result.geminiImageModel = providerProfiles.gemini.imageModel || result.geminiImageModel;

  if (
    JSON.stringify(providerProfiles) !== JSON.stringify(merged.providerProfiles || {}) ||
    JSON.stringify(promptProviderProfiles) !== JSON.stringify(merged.promptProviderProfiles || {}) ||
    JSON.stringify(imageProviderProfiles) !== JSON.stringify(merged.imageProviderProfiles || {}) ||
    Object.keys(updates).length > 0
  ) {
    await chrome.storage.local.set({ providerProfiles, promptProviderProfiles, imageProviderProfiles });
  }

  return result;
}

async function saveSettings(payload) {
  const current = await getSettings();
  const promptProvider = normalizeProviderName(payload.promptProvider || current.promptProvider);
  const imageProvider = normalizeProviderName(payload.imageProvider || current.imageProvider);
  const sanitized = sanitizeSettings(payload);
  const promptProviderProfiles = {
    ...current.promptProviderProfiles,
    [promptProvider]: sanitizePromptProviderProfile(promptProvider, {
      ...(current.promptProviderProfiles?.[promptProvider] || {}),
      apiKey: sanitized.promptApiKey,
      model: sanitized.promptModel,
      baseUrl: sanitized.promptBaseUrl,
      autoAnalyze: "autoAnalyze" in sanitized ? sanitized.autoAnalyze : current.autoAnalyze
    })
  };
  const imageProviderProfiles = {
    ...current.imageProviderProfiles,
    [imageProvider]: sanitizeImageProviderProfile(imageProvider, {
      ...(current.imageProviderProfiles?.[imageProvider] || {}),
      apiKey: sanitized.imageApiKey,
      model: sanitized.imageModel,
      baseUrl: sanitized.imageBaseUrl,
      imageGenerationEnabled:
        "imageGenerationEnabled" in sanitized
          ? sanitized.imageGenerationEnabled
          : current.imageGenerationEnabled
    })
  };
  const providerProfiles = {
    ...current.providerProfiles,
    [promptProvider]: mergeLegacyProviderProfile(
      current.providerProfiles?.[promptProvider],
      promptProvider,
      promptProviderProfiles[promptProvider],
      imageProvider === promptProvider ? imageProviderProfiles[imageProvider] : null
    ),
    ...(imageProvider !== promptProvider
      ? {
          [imageProvider]: mergeLegacyProviderProfile(
            current.providerProfiles?.[imageProvider],
            imageProvider,
            promptProvider === imageProvider ? promptProviderProfiles[promptProvider] : null,
            imageProviderProfiles[imageProvider]
          )
        }
      : {})
  };
  const activePromptProfile = promptProviderProfiles[promptProvider];
  const activeImageProfile = imageProviderProfiles[imageProvider];
  const geminiLegacyProfile = providerProfiles.gemini || {};
  const openaiLegacyProfile = providerProfiles["openai-compatible"] || {};
  const next = {
    provider: promptProvider,
    promptProvider,
    imageProvider,
    apiMode: sanitized.apiMode || current.apiMode || "direct",
    uiLanguage: "uiLanguage" in sanitized ? sanitized.uiLanguage : current.uiLanguage || "auto",
    providerProfiles,
    promptProviderProfiles,
    imageProviderProfiles,
    promptApiKey: activePromptProfile.apiKey,
    promptModel: activePromptProfile.model,
    promptBaseUrl: activePromptProfile.baseUrl,
    autoAnalyze: activePromptProfile.autoAnalyze,
    imageGenerationEnabled: activeImageProfile.imageGenerationEnabled,
    imageApiKey: activeImageProfile.apiKey,
    imageModel: activeImageProfile.model,
    imageBaseUrl: activeImageProfile.baseUrl,
    geminiBaseUrl: geminiLegacyProfile.geminiBaseUrl || current.geminiBaseUrl || GEMINI_DEFAULT_BASE_URL,
    openaiBaseUrl:
      openaiLegacyProfile.openaiBaseUrl || current.openaiBaseUrl || OPENAI_DEFAULT_BASE_URL,
    customProxyUrl:
      "customProxyUrl" in sanitized ? sanitized.customProxyUrl : current.customProxyUrl || "",
    customProxyToken:
      "customProxyToken" in sanitized ? sanitized.customProxyToken : current.customProxyToken || "",
    enableChineseRecognition:
      "enableChineseRecognition" in sanitized
        ? sanitized.enableChineseRecognition
        : current.enableChineseRecognition !== false
  };

  next.geminiApiKey = providerProfiles.gemini?.promptApiKey || current.geminiApiKey || "";
  next.geminiTextModel = providerProfiles.gemini?.promptModel || current.geminiTextModel || DEFAULT_PROMPT_MODEL;
  next.geminiImageModel = providerProfiles.gemini?.imageModel || current.geminiImageModel || DEFAULT_IMAGE_MODEL;

  await chrome.storage.local.set(next);
  await setupContextMenus();
  return getSettings();
}

function sanitizeSettings(payload) {
  const next = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    if (typeof DEFAULT_SETTINGS[key] === "boolean") {
      next[key] = Boolean(value);
      continue;
    }
    if (typeof DEFAULT_SETTINGS[key] === "number") {
      next[key] = Number(value);
      continue;
    }
    if (isPlainObject(DEFAULT_SETTINGS[key])) {
      next[key] = isPlainObject(value) ? value : {};
      continue;
    }
    next[key] = String(value ?? "");
  }

  return next;
}

function buildProviderProfiles(settings) {
  const storedProfiles = isPlainObject(settings.providerProfiles) ? settings.providerProfiles : {};
  const activeProfileFallback = pickProviderProfileFields(settings);
  const geminiFallback =
    settings.provider === "gemini"
      ? activeProfileFallback
      : {
          apiMode: "direct",
          promptApiKey: settings.geminiApiKey || settings.promptApiKey || "",
          promptModel: settings.geminiTextModel || settings.promptModel || DEFAULT_PROMPT_MODEL,
          imageGenerationEnabled: settings.imageGenerationEnabled,
          imageApiKey: settings.imageApiKey || settings.geminiApiKey || "",
          imageModel: settings.geminiImageModel || settings.imageModel || DEFAULT_IMAGE_MODEL,
          geminiBaseUrl: settings.geminiBaseUrl || GEMINI_DEFAULT_BASE_URL,
          openaiBaseUrl: OPENAI_DEFAULT_BASE_URL,
          customProxyUrl: settings.customProxyUrl || "",
          customProxyToken: settings.customProxyToken || "",
          autoAnalyze: settings.autoAnalyze
        };
  const openaiFallback = settings.provider === "openai-compatible" ? activeProfileFallback : {};

  return {
    gemini: sanitizeProviderProfile("gemini", {
      ...geminiFallback,
      ...(storedProfiles.gemini || {})
    }),
    "openai-compatible": sanitizeProviderProfile("openai-compatible", {
      ...openaiFallback,
      ...(storedProfiles["openai-compatible"] || {})
    })
  };
}

function buildPromptProviderProfiles(settings, legacyProfiles) {
  const storedProfiles = isPlainObject(settings.promptProviderProfiles) ? settings.promptProviderProfiles : {};

  return Object.fromEntries(
    SUPPORTED_PROVIDERS.map((provider) => [
      provider,
      sanitizePromptProviderProfile(provider, {
        ...deriveLegacyPromptProfile(settings, legacyProfiles?.[provider], provider),
        ...(storedProfiles[provider] || {})
      })
    ])
  );
}

function buildImageProviderProfiles(settings, legacyProfiles) {
  const storedProfiles = isPlainObject(settings.imageProviderProfiles) ? settings.imageProviderProfiles : {};

  return Object.fromEntries(
    SUPPORTED_PROVIDERS.map((provider) => [
      provider,
      sanitizeImageProviderProfile(provider, {
        ...deriveLegacyImageProfile(settings, legacyProfiles?.[provider], provider),
        ...(storedProfiles[provider] || {})
      })
    ])
  );
}

function repairActiveProviderProfiles(settings, promptProfiles, imageProfiles) {
  const promptProfile = promptProfiles?.[settings.promptProvider];
  if (promptProfile) {
    if (!promptProfile.apiKey && settings.promptApiKey) {
      promptProfile.apiKey = settings.promptApiKey;
    }
    if (!promptProfile.model && settings.promptModel) {
      promptProfile.model = settings.promptModel;
    }
    if (!promptProfile.baseUrl && settings.promptBaseUrl) {
      promptProfile.baseUrl = settings.promptBaseUrl;
    }
    if (settings.promptProvider === "gemini" && shouldResetGeminiProfileBaseUrl(promptProfile)) {
      promptProfile.baseUrl = settings.geminiBaseUrl || GEMINI_DEFAULT_BASE_URL;
    }
    if (
      settings.promptProvider === "openai-compatible" &&
      shouldResetOpenAIProfileBaseUrl(promptProfile)
    ) {
      promptProfile.baseUrl = settings.openaiBaseUrl || OPENAI_DEFAULT_BASE_URL;
    }
  }

  const imageProfile = imageProfiles?.[settings.imageProvider];
  if (imageProfile) {
    if (!imageProfile.apiKey && settings.imageApiKey) {
      imageProfile.apiKey = settings.imageApiKey;
    }
    if (!imageProfile.model && settings.imageModel) {
      imageProfile.model = settings.imageModel;
    }
    if (!imageProfile.baseUrl && settings.imageBaseUrl) {
      imageProfile.baseUrl = settings.imageBaseUrl;
    }
    if (settings.imageProvider === "gemini" && shouldResetGeminiProfileBaseUrl(imageProfile)) {
      imageProfile.baseUrl = settings.geminiBaseUrl || GEMINI_DEFAULT_BASE_URL;
    }
    if (
      settings.imageProvider === "openai-compatible" &&
      shouldResetOpenAIProfileBaseUrl(imageProfile)
    ) {
      imageProfile.baseUrl = settings.openaiBaseUrl || OPENAI_DEFAULT_BASE_URL;
    }
  }
}

function repairGeminiLegacyProfile(settings, legacyProfiles, promptProfiles, imageProfiles) {
  if (legacyProfiles?.gemini) {
    if (!legacyProfiles.gemini.promptApiKey && settings.geminiApiKey) {
      legacyProfiles.gemini.promptApiKey = settings.geminiApiKey;
    }
    if (!legacyProfiles.gemini.promptModel && settings.geminiTextModel) {
      legacyProfiles.gemini.promptModel = settings.geminiTextModel;
    }
    if (!legacyProfiles.gemini.imageModel && settings.geminiImageModel) {
      legacyProfiles.gemini.imageModel = settings.geminiImageModel;
    }
  }

  if (promptProfiles?.gemini && !promptProfiles.gemini.apiKey && settings.geminiApiKey) {
    promptProfiles.gemini.apiKey = settings.geminiApiKey;
  }
  if (imageProfiles?.gemini && !imageProfiles.gemini.apiKey && settings.geminiApiKey) {
    imageProfiles.gemini.apiKey = settings.geminiApiKey;
  }
}

function shouldResetGeminiProfileBaseUrl(profile) {
  const model = String(profile?.model || "").trim().toLowerCase();
  const baseUrl = String(profile?.baseUrl || "").trim().toLowerCase();

  if (!model.startsWith("gemini")) return false;
  if (!baseUrl) return true;
  return looksLikeOpenAICompatibleBaseUrl(baseUrl) && !looksLikeGeminiBaseUrl(baseUrl);
}

function shouldResetOpenAIProfileBaseUrl(profile) {
  const model = String(profile?.model || "").trim().toLowerCase();
  const baseUrl = String(profile?.baseUrl || "").trim().toLowerCase();

  if (!(model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4"))) {
    return false;
  }
  if (!baseUrl) return true;
  return looksLikeGeminiBaseUrl(baseUrl);
}

function looksLikeGeminiBaseUrl(baseUrl) {
  return /generativelanguage\.googleapis\.com/.test(String(baseUrl || "").toLowerCase());
}

function looksLikeOpenAICompatibleBaseUrl(baseUrl) {
  const normalized = String(baseUrl || "").toLowerCase();
  return /api\.openai\.com/.test(normalized) || /openrouter\.ai/.test(normalized);
}

function pickProviderProfileFields(source) {
  return {
    apiMode: source?.apiMode,
    promptApiKey: source?.promptApiKey,
    promptModel: source?.promptModel,
    imageGenerationEnabled: source?.imageGenerationEnabled,
    imageApiKey: source?.imageApiKey,
    imageModel: source?.imageModel,
    geminiBaseUrl: source?.geminiBaseUrl,
    openaiBaseUrl: source?.openaiBaseUrl,
    customProxyUrl: source?.customProxyUrl,
    customProxyToken: source?.customProxyToken,
    autoAnalyze: source?.autoAnalyze
  };
}

function deriveLegacyPromptProfile(settings, legacyProfile, provider) {
  if (settings.promptProvider === provider) {
    return {
      apiKey: settings.promptApiKey,
      model: settings.promptModel,
      baseUrl: settings.promptBaseUrl || getProviderBaseUrl(provider),
      autoAnalyze: settings.autoAnalyze
    };
  }

  return {
    apiKey: legacyProfile?.promptApiKey || "",
    model: legacyProfile?.promptModel || getProviderDefaults(provider).promptModel,
    baseUrl: getLegacyProfileBaseUrl(legacyProfile, provider),
    autoAnalyze: true
  };
}

function deriveLegacyImageProfile(settings, legacyProfile, provider) {
  if (settings.imageProvider === provider) {
    return {
      apiKey: settings.imageApiKey,
      model: settings.imageModel,
      baseUrl: settings.imageBaseUrl || getProviderBaseUrl(provider),
      imageGenerationEnabled: settings.imageGenerationEnabled
    };
  }

  return {
    apiKey: legacyProfile?.imageApiKey || "",
    model: legacyProfile?.imageModel || getProviderDefaults(provider).imageModel,
    baseUrl: getLegacyProfileBaseUrl(legacyProfile, provider),
    imageGenerationEnabled: true
  };
}

function sanitizePromptProviderProfile(provider, input) {
  const defaults = getPromptProviderDefaults(provider);
  const merged = { ...defaults, ...(isPlainObject(input) ? input : {}) };

  return {
    apiKey: String(merged.apiKey || ""),
    model: String(merged.model || defaults.model),
    baseUrl: String(merged.baseUrl || defaults.baseUrl),
    autoAnalyze: Boolean(merged.autoAnalyze)
  };
}

function sanitizeImageProviderProfile(provider, input) {
  const defaults = getImageProviderDefaults(provider);
  const merged = { ...defaults, ...(isPlainObject(input) ? input : {}) };

  return {
    apiKey: String(merged.apiKey || ""),
    model: String(merged.model || defaults.model),
    baseUrl: String(merged.baseUrl || defaults.baseUrl),
    imageGenerationEnabled: Boolean(merged.imageGenerationEnabled)
  };
}

function getPromptProviderDefaults(provider) {
  return {
    apiKey: "",
    model: provider === "openai-compatible" ? "gpt-5.5" : DEFAULT_PROMPT_MODEL,
    baseUrl: getProviderBaseUrl(provider),
    autoAnalyze: true
  };
}

function getImageProviderDefaults(provider) {
  return {
    apiKey: "",
    model: provider === "openai-compatible" ? OPENAI_LATEST_IMAGE_MODEL : DEFAULT_IMAGE_MODEL,
    baseUrl: getProviderBaseUrl(provider),
    imageGenerationEnabled: true
  };
}

function getProviderBaseUrl(provider) {
  return provider === "openai-compatible" ? OPENAI_DEFAULT_BASE_URL : GEMINI_DEFAULT_BASE_URL;
}

function getLegacyProfileBaseUrl(legacyProfile, provider) {
  if (provider === "openai-compatible") {
    return String(legacyProfile?.openaiBaseUrl || OPENAI_DEFAULT_BASE_URL);
  }
  return String(legacyProfile?.geminiBaseUrl || GEMINI_DEFAULT_BASE_URL);
}

function mergeLegacyProviderProfile(existingProfile, provider, promptProfile, imageProfile) {
  const base = sanitizeProviderProfile(provider, existingProfile || {});
  const mergedPrompt = promptProfile || deriveLegacyPromptProfile({}, existingProfile || {}, provider);
  const mergedImage = imageProfile || deriveLegacyImageProfile({}, existingProfile || {}, provider);

  return {
    ...base,
    promptApiKey: mergedPrompt.apiKey,
    promptModel: mergedPrompt.model,
    imageGenerationEnabled: mergedImage.imageGenerationEnabled,
    imageApiKey: mergedImage.apiKey,
    imageModel: mergedImage.model,
    geminiBaseUrl: provider === "gemini" ? mergedPrompt.baseUrl : base.geminiBaseUrl,
    openaiBaseUrl: provider === "openai-compatible" ? mergedPrompt.baseUrl : base.openaiBaseUrl,
    autoAnalyze: mergedPrompt.autoAnalyze
  };
}

function sanitizeProviderProfile(provider, input) {
  const defaults = getProviderDefaults(provider);
  const merged = { ...defaults, ...(isPlainObject(input) ? input : {}) };

  return {
    apiMode: merged.apiMode === "proxy" ? "proxy" : "direct",
    promptApiKey: String(merged.promptApiKey || ""),
    promptModel: String(merged.promptModel || defaults.promptModel),
    imageGenerationEnabled: Boolean(merged.imageGenerationEnabled),
    imageApiKey: String(merged.imageApiKey || ""),
    imageModel: String(merged.imageModel || defaults.imageModel),
    geminiBaseUrl: String(merged.geminiBaseUrl || defaults.geminiBaseUrl),
    openaiBaseUrl: String(merged.openaiBaseUrl || defaults.openaiBaseUrl),
    customProxyUrl: String(merged.customProxyUrl || ""),
    customProxyToken: String(merged.customProxyToken || ""),
    autoAnalyze: Boolean(merged.autoAnalyze)
  };
}

function getProviderDefaults(provider) {
  if (provider === "openai-compatible") {
    return {
      apiMode: "direct",
      promptApiKey: "",
      promptModel: "gpt-5.5",
      imageGenerationEnabled: true,
      imageApiKey: "",
      imageModel: OPENAI_LATEST_IMAGE_MODEL,
      geminiBaseUrl: GEMINI_DEFAULT_BASE_URL,
      openaiBaseUrl: OPENAI_DEFAULT_BASE_URL,
      customProxyUrl: "",
      customProxyToken: "",
      autoAnalyze: true
    };
  }

  return {
    apiMode: "direct",
    promptApiKey: "",
    promptModel: DEFAULT_PROMPT_MODEL,
    imageGenerationEnabled: true,
    imageApiKey: "",
    imageModel: DEFAULT_IMAGE_MODEL,
    geminiBaseUrl: GEMINI_DEFAULT_BASE_URL,
    openaiBaseUrl: OPENAI_DEFAULT_BASE_URL,
    customProxyUrl: "",
    customProxyToken: "",
    autoAnalyze: true
  };
}

function normalizeProviderName(value) {
  const normalized = String(value || "").trim();
  return SUPPORTED_PROVIDERS.includes(normalized) ? normalized : "gemini";
}

function getSettingsTranslator(settings) {
  return globalThis.ImageLensI18n.createTranslator(settings?.uiLanguage || "auto");
}

async function analyzeImage(payload, sender) {
  const settings = await getSettings();
  const imageUrl = normalizeImageUrl(payload.imageUrl);
  const imageDataUrl = normalizeImageDataUrl(payload.imageDataUrl);

  if (!imageUrl && !imageDataUrl) {
    throw new Error("Missing image URL.");
  }

  if (settings.apiMode === "proxy") {
    return callProxy(settings, "/analyze", {
      imageUrl,
      pageUrl: payload.pageUrl || "",
      alt: payload.alt || ""
    });
  }

  ensurePromptApiKey(settings);

  const imagePart = await prepareImageForAnalysis(
    await fetchImageAsInlineData({
      imageUrl,
      imageDataUrl,
      pageUrl: payload.pageUrl || "",
      screenshotCrop: normalizeScreenshotCrop(payload.screenshotCrop),
      sender
    })
  );
  const includeChinese = settings.enableChineseRecognition !== false;
  const request = {
    instructions: buildAnalysisInstructions({ includeChinese }),
    text: buildAnalysisRequestText({ alt: payload.alt }),
    imagePart,
    includeChinese
  };

  const rawText =
    settings.promptProvider === "openai-compatible"
      ? await analyzeImageWithOpenAICompatible(settings, request)
      : await analyzeImageWithGemini(settings, request);
  const t = getSettingsTranslator(settings).t;
  let parsed;
  try {
    parsed = parseLooseJson(rawText);
  } catch (_error) {
    throw new Error(t("backgroundInvalidAnalysisJson"));
  }

  const result = normalizeAnalysisResult(parsed, { includeChinese });
  if (!result) {
    throw new Error(t("backgroundEmptyAnalysis"));
  }

  return {
    ...result,
    sourceImageUrl: imageUrl || imageDataUrl
  };
}

async function generateImage(payload) {
  const settings = await getSettings();
  const prompt = String(payload.prompt || "").trim();
  const shouldOpenViewer = Boolean(payload.openViewer);
  const t = getSettingsTranslator(settings).t;

  if (!settings.imageGenerationEnabled) {
    throw new Error(t("backgroundGenerationDisabled"));
  }

  if (!prompt) {
    throw new Error("Missing prompt for generation.");
  }

  if (settings.apiMode === "proxy") {
    const result = await callProxy(settings, "/generate", {
      prompt,
      aspectRatio: payload.aspectRatio || settings.aspectRatio,
      count: payload.count || settings.imageCount || 1
    });

    const viewer = await saveViewerImages(result.images || [], prompt);
    if (shouldOpenViewer) {
      await openViewerTab();
    }
    return { ...result, ...viewer };
  }

  ensureImageApiKey(settings);

  const images =
    settings.imageProvider === "openai-compatible"
      ? await generateImageWithOpenAICompatible(settings, payload, prompt)
      : await generateImageWithGemini(settings, payload, prompt);

  if (images.length === 0) {
    throw new Error("Image generation returned no images.");
  }

  const viewer = await saveViewerImages(images, prompt);
  if (shouldOpenViewer) {
    await openViewerTab();
  }

  return {
    images,
    provider: settings.imageProvider,
    model: settings.imageModel,
    ...viewer
  };
}

async function openViewer(payload = {}) {
  const images = Array.isArray(payload.images) ? payload.images : [];
  const prompt = String(payload.prompt || "").trim();

  if (images.length > 0 || prompt) {
    await saveViewerImages(images, prompt);
  }

  await openViewerTab();
  return { opened: true };
}

async function analyzeImageWithGemini(settings, { instructions, text: requestText, imagePart, includeChinese }) {
  const imageInput = {
    inline_data: {
      mime_type: imagePart.mimeType,
      data: imagePart.data
    }
  };
  const call = (structured) =>
    callGeminiGenerateContent({
      baseUrl: settings.promptBaseUrl,
      apiKey: settings.promptApiKey,
      model: settings.promptModel,
      ...(structured
        ? {
            systemInstruction: { parts: [{ text: instructions }] },
            contents: [{ parts: [{ text: requestText }, imageInput] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: buildGeminiResponseSchema({ includeChinese })
            }
          }
        : {
            contents: [{ parts: [{ text: `${instructions}\n\n${requestText}` }, imageInput] }]
          })
    });

  const response = await withPlainRequestFallback(call);

  const text = extractTextFromGemini(response);
  if (!text) {
    const reason =
      response?.promptFeedback?.blockReason || response?.candidates?.[0]?.finishReason || "empty response";
    throw new Error(getSettingsTranslator(settings).t("backgroundNoAnalysisResult", { reason }));
  }
  return text;
}

async function analyzeImageWithOpenAICompatible(settings, { instructions, text: requestText, imagePart }) {
  const imageInput = {
    type: "image_url",
    image_url: {
      url: `data:${imagePart.mimeType};base64,${imagePart.data}`
    }
  };
  const call = (structured) =>
    callOpenAICompatibleChatCompletion({
      baseUrl: settings.promptBaseUrl,
      apiKey: settings.promptApiKey,
      model: settings.promptModel || OPENAI_DEFAULT_PROMPT_MODEL,
      messages: structured
        ? [
            { role: "system", content: instructions },
            { role: "user", content: [{ type: "text", text: requestText }, imageInput] }
          ]
        : [{ role: "user", content: [{ type: "text", text: `${instructions}\n\n${requestText}` }, imageInput] }],
      ...(structured ? { response_format: { type: "json_object" } } : {})
    });

  const response = await withPlainRequestFallback(call);

  const text = extractTextFromOpenAICompatible(response);
  if (!text) {
    const choice = response?.choices?.[0];
    const reason = choice?.message?.refusal || choice?.finish_reason || "empty response";
    throw new Error(getSettingsTranslator(settings).t("backgroundNoAnalysisResult", { reason }));
  }
  return text;
}

async function generateImageWithGemini(settings, payload, prompt) {
  const data = await callGeminiGenerateContent({
    baseUrl: settings.imageBaseUrl,
    apiKey: settings.imageApiKey,
    model: settings.imageModel,
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      responseModalities: ["Image"],
      imageConfig: {
        aspectRatio: payload.aspectRatio || settings.aspectRatio || "1:1"
      }
    }
  });

  return extractImagesFromGemini(data);
}

async function generateImageWithOpenAICompatible(settings, payload, prompt) {
  const size = mapAspectRatioToOpenAIImageSize(payload.aspectRatio || settings.aspectRatio || "1:1");
  const count = clampImageCount(payload.count || settings.imageCount || 1);
  const response = await callOpenAICompatibleImagesGenerate({
    baseUrl: settings.imageBaseUrl,
    apiKey: settings.imageApiKey,
    model: settings.imageModel || OPENAI_LATEST_IMAGE_MODEL,
    prompt,
    n: count,
    size
  });

  return extractImagesFromOpenAICompatible(response);
}

async function openOptionsPage() {
  await chrome.runtime.openOptionsPage();
  return { opened: true };
}

function ensurePromptApiKey(settings) {
  if (!settings.promptApiKey) {
    throw new Error(getSettingsTranslator(settings).t("backgroundPromptApiMissing"));
  }
}

function ensureImageApiKey(settings) {
  if (!settings.imageApiKey) {
    throw new Error(getSettingsTranslator(settings).t("backgroundImageApiMissing"));
  }
}

async function callProxy(settings, path, payload) {
  if (!settings.customProxyUrl) {
    throw new Error("Proxy mode is enabled, but no proxy URL is configured.");
  }

  const url = new URL(path, ensureTrailingSlash(settings.customProxyUrl));
  const headers = {
    "Content-Type": "application/json"
  };

  if (settings.customProxyToken) {
    headers.Authorization = `Bearer ${settings.customProxyToken}`;
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  return parseApiResponse(response);
}

async function callGeminiGenerateContent({ baseUrl, apiKey, model, contents, generationConfig, systemInstruction }) {
  const endpoint = buildGeminiUrl(
    baseUrl,
    `/models/${encodeURIComponent(model)}:generateContent`
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      ...(systemInstruction ? { systemInstruction } : {}),
      contents,
      ...(generationConfig ? { generationConfig } : {})
    })
  });

  return parseApiResponse(response);
}

// Some gateways and older models reject a system prompt, a response schema or
// JSON mode with a 400. Try the structured request first, then fall back to a
// plain one that carries the same instructions in the user message.
async function withPlainRequestFallback(call) {
  try {
    return await call(true);
  } catch (error) {
    if (error.status !== 400) throw error;
    console.warn("[Image Lens] Structured analysis request was rejected, retrying as plain request.", error);
    return call(false);
  }
}

function buildGeminiUrl(baseUrl, path) {
  const normalizedBaseUrl = String(baseUrl || GEMINI_DEFAULT_BASE_URL).trim() || GEMINI_DEFAULT_BASE_URL;
  return new URL(path.replace(/^\//, ""), ensureTrailingSlash(normalizedBaseUrl)).toString();
}

async function callOpenAICompatibleChatCompletion({ baseUrl, apiKey, ...payload }) {
  const endpoint = buildOpenAICompatibleUrl(baseUrl, "/chat/completions");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  return parseApiResponse(response);
}

async function callOpenAICompatibleImagesGenerate({ baseUrl, apiKey, ...payload }) {
  const endpoint = buildOpenAICompatibleUrl(baseUrl, "/images/generations");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  return parseApiResponse(response);
}

function buildOpenAICompatibleUrl(baseUrl, path) {
  const normalizedBaseUrl = String(baseUrl || OPENAI_DEFAULT_BASE_URL).trim() || OPENAI_DEFAULT_BASE_URL;
  return new URL(path.replace(/^\//, ""), ensureTrailingSlash(normalizedBaseUrl)).toString();
}

async function parseApiResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_error) {
    // Gateways often answer errors with an HTML page instead of JSON.
    if (!response.ok) {
      throw createApiError(`Request failed with status ${response.status}.`, response.status);
    }
    throw new Error("API returned a non-JSON response. Check the Base URL.");
  }

  if (!response.ok) {
    throw createApiError(
      data?.error?.message || data?.message || `Request failed with status ${response.status}.`,
      response.status
    );
  }

  return data;
}

function createApiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function extractTextFromGemini(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractTextFromOpenAICompatible(data) {
  const messageContent = data?.choices?.[0]?.message?.content;

  if (typeof messageContent === "string") {
    return messageContent.trim();
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => part?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

// Returns the same { mimeType, base64Data } shape as extractImagesFromGemini,
// which is what the panel and viewer render. URL results are downloaded here
// because providers usually expire them after a short time.
async function extractImagesFromOpenAICompatible(data) {
  const items = Array.isArray(data?.data) ? data.data : [];
  const defaultMimeType = `image/${String(data?.output_format || "png").toLowerCase()}`;

  const images = await Promise.all(
    items.map(async (item) => {
      if (item?.b64_json) {
        return { mimeType: defaultMimeType, base64Data: item.b64_json };
      }
      if (item?.url) {
        if (item.url.startsWith("data:")) {
          const { mimeType, data: base64Data } = parseDataUrlImage(item.url);
          return { mimeType, base64Data };
        }
        const response = await fetch(item.url);
        if (!response.ok) {
          throw new Error(`Failed to download generated image (${response.status}).`);
        }
        const blob = await response.blob();
        return {
          mimeType: blob.type || guessMimeType(item.url),
          base64Data: arrayBufferToBase64(await blob.arrayBuffer())
        };
      }
      return null;
    })
  );

  return images.filter(Boolean);
}

function mapAspectRatioToOpenAIImageSize(aspectRatio) {
  return OPENAI_IMAGE_SIZE_BY_RATIO[aspectRatio] || OPENAI_IMAGE_SIZE_BY_RATIO["1:1"];
}

function clampImageCount(value) {
  const count = Number(value) || 1;
  return Math.max(1, Math.min(4, count));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Vision models gain nothing from very large inputs, and big uploads are slow,
// cost more and hit gateway size limits. Images whose long edge exceeds this
// are scaled down and re-encoded as JPEG.
const MAX_ANALYSIS_IMAGE_EDGE = 1600;
const MAX_ANALYSIS_BASE64_LENGTH = 2_000_000;

async function prepareImageForAnalysis(imagePart) {
  try {
    const bytes = Uint8Array.from(atob(imagePart.data), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: imagePart.mimeType }));
    const scale = Math.min(1, MAX_ANALYSIS_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));

    if (scale === 1 && imagePart.data.length <= MAX_ANALYSIS_BASE64_LENGTH) {
      bitmap.close();
      return imagePart;
    }

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    // JPEG has no transparency; paint transparent areas white instead of black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return {
      mimeType: "image/jpeg",
      data: arrayBufferToBase64(await blob.arrayBuffer())
    };
  } catch (error) {
    // Formats the worker cannot decode (such as SVG) are sent unchanged.
    console.warn("[Image Lens] Could not resize image, sending the original.", error);
    return imagePart;
  }
}

async function fetchImageAsInlineData({ imageUrl, imageDataUrl, pageUrl, screenshotCrop, sender }) {
  if (imageDataUrl) {
    return parseDataUrlImage(imageDataUrl);
  }

  try {
    const fetchOptions = {
      credentials: "include"
    };
    const normalizedPageUrl = String(pageUrl || "").trim();
    if (/^https?:\/\//i.test(normalizedPageUrl)) {
      fetchOptions.referrer = normalizedPageUrl;
    }

    const response = await fetch(imageUrl, fetchOptions);

    if (!response.ok) {
      throw new Error(`Failed to fetch image (${response.status}).`);
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();

    return {
      mimeType: blob.type || guessMimeType(imageUrl),
      data: arrayBufferToBase64(buffer)
    };
  } catch (error) {
    if (screenshotCrop && sender?.tab?.windowId !== undefined) {
      return captureVisibleTabImagePart(sender.tab.windowId, screenshotCrop);
    }
    throw error;
  }
}

function parseDataUrlImage(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) {
    throw new Error("Unsupported inline image format.");
  }

  return {
    mimeType: match[1] || "image/png",
    data: match[2]
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function guessMimeType(url) {
  const normalized = url.toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function normalizeImageDataUrl(value) {
  const dataUrl = String(value || "").trim();
  return dataUrl.startsWith("data:image/") ? dataUrl : "";
}

function normalizeScreenshotCrop(value) {
  if (!isPlainObject(value)) return null;

  const crop = {
    x: Number(value.x),
    y: Number(value.y),
    width: Number(value.width),
    height: Number(value.height),
    devicePixelRatio: Number(value.devicePixelRatio) || 1
  };

  if (
    !Number.isFinite(crop.x) ||
    !Number.isFinite(crop.y) ||
    !Number.isFinite(crop.width) ||
    !Number.isFinite(crop.height) ||
    crop.width <= 0 ||
    crop.height <= 0
  ) {
    return null;
  }

  return crop;
}

async function captureRegion(payload, sender) {
  const t = getSettingsTranslator(await getSettings()).t;
  const crop = normalizeScreenshotCrop(payload.crop);
  if (!crop) {
    throw new Error(t("backgroundInvalidRegion"));
  }
  if (sender?.tab?.windowId === undefined) {
    throw new Error(t("backgroundTabUnavailable"));
  }

  const imagePart = await captureVisibleTabImagePart(sender.tab.windowId, crop);
  return {
    dataUrl: `data:${imagePart.mimeType};base64,${imagePart.data}`
  };
}

async function captureVisibleTabImagePart(windowId, crop) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png"
  });
  return cropCapturedImage(dataUrl, crop);
}

async function cropCapturedImage(dataUrl, crop) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const scale = crop.devicePixelRatio || 1;
  const sx = Math.max(0, Math.floor(crop.x * scale));
  const sy = Math.max(0, Math.floor(crop.y * scale));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.floor(crop.width * scale)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.floor(crop.height * scale)));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create canvas context for screenshot crop.");
  }

  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const croppedBlob = await canvas.convertToBlob({
    type: "image/png"
  });
  const buffer = await croppedBlob.arrayBuffer();

  return {
    mimeType: "image/png",
    data: arrayBufferToBase64(buffer)
  };
}

function extractImagesFromGemini(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  return candidates
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => {
      const raw = part?.inlineData?.data || part?.inline_data?.data;
      if (!raw) return null;
      return {
        mimeType: part?.inlineData?.mimeType || part?.inline_data?.mime_type || "image/png",
        base64Data: raw
      };
    })
    .filter(Boolean);
}

async function saveViewerImages(images, prompt) {
  await writeViewerPayload({
    id: VIEWER_RECORD_ID,
    createdAt: Date.now(),
    prompt,
    images
  });

  return {
    viewerUrl: chrome.runtime.getURL("viewer.html")
  };
}

async function openViewerTab() {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("viewer.html")
  });
}

function normalizeImageUrl(url) {
  const normalized = String(url || "").trim();
  if (!normalized) return "";
  return normalized;
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

async function writeViewerPayload(payload) {
  const db = await openViewerDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(VIEWER_STORE_NAME, "readwrite");
    const store = tx.objectStore(VIEWER_STORE_NAME);
    const request = store.put(payload);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Failed to write viewer payload."));
  });
  db.close();
}

function openViewerDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIEWER_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VIEWER_STORE_NAME)) {
        db.createObjectStore(VIEWER_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open viewer database."));
  });
}
