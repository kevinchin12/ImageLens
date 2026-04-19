const DEFAULT_SETTINGS = {
  provider: "gemini",
  apiMode: "direct",
  geminiApiKey: "",
  geminiTextModel: "gemini-2.5-flash",
  geminiImageModel: "imagen-4.0-generate-001",
  customProxyUrl: "",
  customProxyToken: "",
  defaultLanguage: "zh",
  autoAnalyze: true,
  aspectRatio: "1:1",
  imageCount: 1
};

const VIEWER_DB_NAME = "prompt-glass-db";
const VIEWER_STORE_NAME = "viewer_payloads";
const VIEWER_RECORD_ID = "current";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).filter(([key]) => !(key in existing))
  );
  if (Object.keys(missing).length > 0) {
    await chrome.storage.local.set(missing);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      console.error("[Prompt Glass]", error);
      sendResponse({ ok: false, error: error.message || "Unknown error" });
    });

  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case "get-settings":
      return getSettings();
    case "save-settings":
      return saveSettings(message.payload || {});
    case "analyze-image":
      return analyzeImage(message.payload || {});
    case "translate-prompt":
      return translatePrompt(message.payload || {});
    case "generate-image":
      return generateImage(message.payload || {});
    case "open-viewer":
      return openViewer(message.payload || {});
    default:
      throw new Error(`Unsupported message type: ${message.type}`);
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(payload) {
  const next = sanitizeSettings(payload);
  await chrome.storage.local.set(next);
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
    next[key] = String(value ?? "");
  }

  return next;
}

async function analyzeImage(payload) {
  const settings = await getSettings();
  const imageUrl = normalizeImageUrl(payload.imageUrl);

  if (!imageUrl) {
    throw new Error("Missing image URL.");
  }

  if (settings.apiMode === "proxy") {
    return callProxy(settings, "/analyze", {
      imageUrl,
      pageUrl: payload.pageUrl || "",
      alt: payload.alt || ""
    });
  }

  ensureDirectApiKey(settings);

  const imagePart = await fetchImageAsInlineData(imageUrl);
  const prompt = [
    "你是一个专业的图像提示词设计助手。",
    "请分析用户提供的图片，并输出适合文生图模型使用的中文提示词。",
    "要求输出 JSON，不要输出 Markdown。",
    'JSON 格式: {"title":"", "zhPromptShort":"", "zhPromptFull":"", "keywords":[""]}',
    "规则：",
    "1. zhPromptShort 是精简版提示词，只保留核心视觉信息，用两到三句话完成。",
    "2. zhPromptFull 是完整细化版提示词，重点描述主体、构图、镜头、光线、材质、色彩、风格、氛围和细节。",
    "3. 不要臆造商标、人物身份或受版权保护角色名；不确定时用通用描述。",
    "4. title 用 12 字以内概括主题。",
    "5. keywords 给 6 到 12 个中文短词。",
    `补充上下文：页面地址 ${payload.pageUrl || "unknown"}；图片 alt ${payload.alt || "none"}。`
  ].join("\n");

  const response = await callGeminiGenerateContent({
    apiKey: settings.geminiApiKey,
    model: settings.geminiTextModel,
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: imagePart.mimeType,
              data: imagePart.data
            }
          }
        ]
      }
    ]
  });

  const rawText = extractTextFromGemini(response);
  const parsed = parseLooseJson(rawText);

  if (!parsed?.zhPromptShort || !parsed?.zhPromptFull) {
    throw new Error("Model did not return a valid prompt.");
  }

  return {
    title: String(parsed.title || "图片提示词"),
    zhPromptShort: String(parsed.zhPromptShort || "").trim(),
    zhPromptFull: String(parsed.zhPromptFull || "").trim(),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
    sourceImageUrl: imageUrl
  };
}

async function translatePrompt(payload) {
  const settings = await getSettings();
  const sourceText = String(payload.text || "").trim();
  const targetLanguage = payload.targetLanguage === "zh" ? "zh" : "en";

  if (!sourceText) {
    throw new Error("Missing source prompt.");
  }

  if (settings.apiMode === "proxy") {
    return callProxy(settings, "/translate", {
      text: sourceText,
      targetLanguage
    });
  }

  ensureDirectApiKey(settings);

  const prompt = [
    "You are a prompt translation assistant.",
    `Translate the following prompt into ${targetLanguage === "en" ? "English" : "Chinese"}.`,
    "Keep it optimized for text-to-image generation.",
    "Preserve structure, descriptive richness, and visual intent.",
    "Return JSON only.",
    '{"translatedText":""}',
    `Prompt: ${sourceText}`
  ].join("\n");

  const response = await callGeminiGenerateContent({
    apiKey: settings.geminiApiKey,
    model: settings.geminiTextModel,
    contents: [{ parts: [{ text: prompt }] }]
  });

  const parsed = parseLooseJson(extractTextFromGemini(response));
  if (!parsed?.translatedText) {
    throw new Error("Translation failed.");
  }

  return {
    translatedText: String(parsed.translatedText).trim()
  };
}

async function generateImage(payload) {
  const settings = await getSettings();
  const prompt = String(payload.prompt || "").trim();
  const shouldOpenViewer = Boolean(payload.openViewer);

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

  ensureDirectApiKey(settings);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      settings.geminiImageModel
    )}:predict`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.geminiApiKey
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: clampImageCount(payload.count || settings.imageCount || 1),
          aspectRatio: payload.aspectRatio || settings.aspectRatio || "1:1"
        }
      })
    }
  );

  const data = await parseApiResponse(response);
  const images = extractImagesFromImagen(data);

  if (images.length === 0) {
    throw new Error("Image generation returned no images.");
  }

  const viewer = await saveViewerImages(images, prompt);
  if (shouldOpenViewer) {
    await openViewerTab();
  }

  return {
    images,
    provider: settings.provider,
    model: settings.geminiImageModel,
    ...viewer
  };
}

async function openViewer() {
  await openViewerTab();
  return { opened: true };
}

function ensureDirectApiKey(settings) {
  if (!settings.geminiApiKey) {
    throw new Error("Gemini API key is not configured. Open the extension options page first.");
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

async function callGeminiGenerateContent({ apiKey, model, contents }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({ contents })
    }
  );

  return parseApiResponse(response);
}

async function parseApiResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(
      data?.error?.message || data?.message || `Request failed with status ${response.status}.`
    );
  }

  return data;
}

function extractTextFromGemini(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseLooseJson(rawText) {
  if (!rawText) return null;

  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : rawText;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  const jsonText =
    firstBrace >= 0 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : candidate;

  return JSON.parse(jsonText);
}

async function fetchImageAsInlineData(imageUrl) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status}).`);
  }

  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();

  return {
    mimeType: blob.type || guessMimeType(imageUrl),
    data: arrayBufferToBase64(buffer)
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

function extractImagesFromImagen(data) {
  const predictions = Array.isArray(data?.predictions) ? data.predictions : [];
  return predictions
    .map((prediction) => {
      const raw = prediction?.bytesBase64Encoded || prediction?.image?.bytesBase64Encoded;
      if (!raw) return null;
      return {
        mimeType: prediction?.mimeType || prediction?.image?.mimeType || "image/png",
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

function clampImageCount(count) {
  return Math.min(4, Math.max(1, Number(count) || 1));
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
