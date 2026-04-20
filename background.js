const DEFAULT_SETTINGS = {
  provider: "gemini",
  apiMode: "direct",
  geminiApiKey: "",
  geminiTextModel: "gemini-2.5-flash",
  geminiImageModel: "gemini-3.1-flash-image-preview",
  customProxyUrl: "",
  customProxyToken: "",
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
  const prompt = buildAnalyzePrompt(payload);

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
  const calibrated = calibratePromptPayload(parsed);

  if (
    !calibrated.zhPromptShort ||
    !calibrated.zhPromptFull ||
    !calibrated.enPromptShort ||
    !calibrated.enPromptFull
  ) {
    throw new Error("Model did not return a valid prompt.");
  }

  return {
    title: calibrated.title,
    enPromptShort: calibrated.enPromptShort,
    enPromptFull: calibrated.enPromptFull,
    zhPromptShort: calibrated.zhPromptShort,
    zhPromptFull: calibrated.zhPromptFull,
    keywords: calibrated.keywords,
    sourceImageUrl: imageUrl
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

async function openOptionsPage() {
  await chrome.runtime.openOptionsPage();
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

function buildAnalyzePrompt(payload) {
  return [
    "角色设定：你是一位资深视觉导演，擅长将视觉图像逆向工程为 Nano Banana 2 专用渲染指令。",
    "核心任务：分析上传图片，提取其视觉基因，并优先还原原图的风格、镜头语言、光影结构、材质细节和构图关系。",
    "输出语言：最终返回自然、连贯的中文提示词。只有在摄影、镜头、渲染、设备或光学术语更准确时，才保留必要的英文专业词汇，例如 Global illumination、ARRI Alexa Cinema Camera、Shot on Hasselblad。",
    "禁止事项：禁止使用空泛形容词，例如 Beautiful、High quality、Amazing、Stunning、Gorgeous；禁止编造商标、人物身份或受版权保护角色名，不确定时用通用描述。",
    "分析图片时必须强制拆解以下四个维度：",
    "1. Camera & Lens：焦段、光圈、机位、拍摄角度，例如 16mm 广角、85mm 人像、f/1.8、f/11、low angle、eye level。",
    "2. Lighting Setup：布光方向、光质与效果，例如 side lighting、rim light、soft diffusion、hard shadows、Tyndall effect、cinematic glow。",
    "3. Material & Texture：微观材质与光学表现，例如 pores、fabric weave、refraction、subsurface scattering。",
    "4. Compositional Logic：构图与空间层次，例如 rule of thirds、centered composition、foreground blur、leading lines。",
    "最终提示词的描述结构必须按以下顺序组织：主体、风格/媒介、光线、镜头、环境。",
    "请先内部完成一次自校验：如果根据最终 Prompt 重新作图，无法还原原图 90% 的核心视觉变量，就在输出前补足缺失项。",
    "输出要求：返回严格合法 JSON，不要 Markdown，不要解释，不要额外前后缀。",
    'JSON 格式：{"title":"","enPromptShort":"","enPromptFull":"","zhPromptShort":"","zhPromptFull":"","keywords":[""],"analysis":{"subject":"","styleMedium":"","lighting":"","camera":"","environment":"","materialTexture":"","composition":""},"nanoBananaTerms":[""]}',
    "字段规则：",
    "1. title 用 12 字以内概括主题。",
    "2. enPromptShort 为精简版英文提示词，用两到三句话完成，但必须覆盖主体、风格、光线和镜头。",
    "3. enPromptFull 为完整版英文提示词，必须覆盖主体、风格/媒介、光线、镜头、环境、材质/纹理、构图逻辑，并尽量贴近 Nano Banana 2 的渲染语言。",
    "4. zhPromptShort 为精简版纯中文提示词，对应 enPromptShort 的语义，不要夹杂无必要的英文说明。",
    "5. zhPromptFull 为完整版纯中文提示词，对应 enPromptFull 的语义，不要夹杂无必要的英文说明。",
    "6. analysis 对象中的每个字段都要尽量填写具体可观察信息，缺失时留空字符串，不要编造。",
    "7. nanoBananaTerms 提供 3 到 8 个与画面强相关的高权重英文术语，优先从这些词中选择：Extreme fidelity、Ray-traced reflections、Volumetric fog、Global illumination、Color graded for cinema、Teal and orange palette、Subsurface scattering、Shot on Hasselblad、ARRI Alexa Cinema Camera、Anamorphic lens flares。",
    "8. keywords 提供 6 到 12 个中文短词。",
    `补充上下文：页面地址 ${payload.pageUrl || "unknown"}；图片 alt ${payload.alt || "none"}。`
  ].join("\n");
}

function calibratePromptPayload(parsed) {
  const analysis = normalizeAnalysis(parsed?.analysis);
  const nanoTerms = selectNanoBananaTerms(parsed?.nanoBananaTerms, analysis);
  const enShortPrompt = finalizePromptVariant(parsed?.enPromptShort, {
    detail: "short",
    language: "en",
    analysis,
    nanoTerms
  });
  const enFullPrompt = finalizePromptVariant(parsed?.enPromptFull, {
    detail: "full",
    language: "en",
    analysis,
    nanoTerms
  });
  const shortPrompt = finalizePromptVariant(parsed?.zhPromptShort, {
    detail: "short",
    language: "zh",
    analysis,
    nanoTerms
  });
  const fullPrompt = finalizePromptVariant(parsed?.zhPromptFull, {
    detail: "full",
    language: "zh",
    analysis,
    nanoTerms
  });
  const keywords = normalizeKeywords(parsed?.keywords, analysis, nanoTerms);

  return {
    title: String(parsed?.title || "图片提示词").trim() || "图片提示词",
    enPromptShort: enShortPrompt,
    enPromptFull: enFullPrompt,
    zhPromptShort: shortPrompt,
    zhPromptFull: fullPrompt,
    keywords
  };
}

function normalizeAnalysis(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    subject: cleanSnippet(source.subject),
    styleMedium: cleanSnippet(source.styleMedium),
    lighting: cleanSnippet(source.lighting),
    camera: cleanSnippet(source.camera),
    environment: cleanSnippet(source.environment),
    materialTexture: cleanSnippet(source.materialTexture),
    composition: cleanSnippet(source.composition)
  };
}

function normalizeKeywords(input, analysis, nanoTerms) {
  const list = Array.isArray(input) ? input.map((item) => cleanSnippet(item)).filter(Boolean) : [];
  const fallbacks = [
    analysis.subject,
    analysis.styleMedium,
    analysis.lighting,
    analysis.camera,
    analysis.materialTexture,
    analysis.composition,
    ...nanoTerms
  ]
    .flatMap((item) => splitKeywordCandidates(item))
    .filter(Boolean);

  return Array.from(new Set([...list, ...fallbacks])).slice(0, 12);
}

function splitKeywordCandidates(text) {
  return String(text || "")
    .split(/[，,、/]|(?:\s+-\s+)/)
    .map((item) => cleanSnippet(item))
    .filter((item) => item && item.length <= 32);
}

function selectNanoBananaTerms(input, analysis) {
  const requested = Array.isArray(input) ? input.map((item) => cleanEnglishTerm(item)).filter(Boolean) : [];
  const merged = new Set(requested);
  const context = [
    analysis.styleMedium,
    analysis.lighting,
    analysis.environment,
    analysis.materialTexture,
    analysis.composition
  ]
    .join(" ")
    .toLowerCase();

  merged.add("Extreme fidelity");
  merged.add("Global illumination");

  if (/(电影|cinema|cinematic|film|胶片|叙事|screen|movie)/i.test(context)) {
    merged.add("Color graded for cinema");
    merged.add("ARRI Alexa Cinema Camera");
  }

  if (/(青橙|teal|orange)/i.test(context)) {
    merged.add("Teal and orange palette");
  }

  if (/(雾|fog|mist|haze|烟|逆光|god ray|丁达尔|volumetric)/i.test(context)) {
    merged.add("Volumetric fog");
  }

  if (/(镜面|反射|玻璃|金属|水面|wet|chrome|reflection|reflective|refraction)/i.test(context)) {
    merged.add("Ray-traced reflections");
  }

  if (/(皮肤|玉石|蜡|叶片|半透明|subsurface|sss|translucent|skin)/i.test(context)) {
    merged.add("Subsurface scattering");
  }

  if (/(宽银幕|anamorphic|flare|光晕|cinema scope)/i.test(context)) {
    merged.add("Anamorphic lens flares");
  }

  if (/(肌理|细节|纹理|commercial|product|fashion|editorial|hasselblad)/i.test(context)) {
    merged.add("Shot on Hasselblad");
  }

  return Array.from(merged).slice(0, 8);
}

function cleanEnglishTerm(text) {
  const normalized = cleanSnippet(text);
  if (!normalized) return "";
  return normalized.replace(/[。；;]+$/g, "");
}

function finalizePromptVariant(text, { detail, language, analysis, nanoTerms }) {
  let normalized = sanitizePromptText(text);

  if (!normalized) {
    normalized = composePromptFromAnalysis(analysis, detail, language);
  }

  normalized = ensureCoverage(normalized, { detail, language, analysis });
  normalized = injectNanoBananaTerms(normalized, nanoTerms, detail, language);
  return normalized.trim();
}

function sanitizePromptText(text) {
  const stripped = String(text || "")
    .replace(/\b(?:Beautiful|High quality|Amazing|Stunning|Gorgeous|Epic|Nice)\b/gi, "")
    .replace(/\b(?:there is|there are|the image shows|the picture shows|in the image)\b/gi, "")
    .replace(/(?:^|[，,。]\s*)(?:画面中|图片中|图像中)(?:展示|呈现|显示|是|有)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[，,]\s*[，,]/g, "，")
    .replace(/[。]\s*[。]/g, "。")
    .trim();

  return stripped
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([，。；：])\s+/g, "$1 ");
}

function composePromptFromAnalysis(analysis, detail, language) {
  const parts = [];

  if (language === "en") {
    if (analysis.subject) parts.push(analysis.subject);
    if (analysis.styleMedium) parts.push(`rendered with ${analysis.styleMedium}`);
    if (analysis.lighting) parts.push(`lighting defined by ${analysis.lighting}`);
    if (analysis.camera) parts.push(`camera language shaped by ${analysis.camera}`);
    if (analysis.environment) parts.push(`environment and spatial relationship described as ${analysis.environment}`);
    if (detail === "full" && analysis.materialTexture) {
      parts.push(`material and texture detail focused on ${analysis.materialTexture}`);
    }
    if (detail === "full" && analysis.composition) {
      parts.push(`composition and spatial layering built around ${analysis.composition}`);
    }
  } else {
    if (analysis.subject) parts.push(analysis.subject);
    if (analysis.styleMedium) parts.push(`整体采用${analysis.styleMedium}的风格与媒介表现`);
    if (analysis.lighting) parts.push(`光线以${analysis.lighting}为主`);
    if (analysis.camera) parts.push(`镜头语言与拍摄方式体现为${analysis.camera}`);
    if (analysis.environment) parts.push(`环境与空间关系呈现为${analysis.environment}`);
    if (detail === "full" && analysis.materialTexture) {
      parts.push(`材质与纹理细节强调${analysis.materialTexture}`);
    }
    if (detail === "full" && analysis.composition) {
      parts.push(`构图与层次关系采用${analysis.composition}`);
    }
  }

  return mergePromptSegments(parts, language);
}

function ensureCoverage(text, { detail, language, analysis }) {
  const additions = [];

  if (!hasLightingSignals(text)) {
    additions.push(
      analysis.lighting ||
        (language === "en"
          ? "natural sunlight with soft diffusion and controlled shadow separation"
          : "自然光配合 soft diffusion，阴影层次清晰")
    );
  }

  if (!hasCameraSignals(text)) {
    additions.push(
      analysis.camera ||
        (language === "en"
          ? "eye-level perspective, 50mm lens, realistic depth of field"
          : "eye-level 视角，50mm 镜头，真实景深")
    );
  }

  if (detail === "full" && !hasMaterialSignals(text)) {
    additions.push(
      analysis.materialTexture ||
        (language === "en"
          ? "clear visible surface texture, realistic fabric weave or skin detail"
          : "可见表面肌理清晰，织物纹理或皮肤细节真实可辨")
    );
  }

  if (detail === "full" && !hasCompositionSignals(text)) {
    additions.push(
      analysis.composition ||
        (language === "en"
          ? "clear subject separation, layered depth, balanced foreground and background relationship"
          : "主体分离明确，空间层次清楚，前后景关系平衡")
    );
  }

  if (detail === "full" && analysis.environment && !hasEnvironmentSignals(text)) {
    additions.push(analysis.environment);
  }

  return mergePromptSegments([text, ...additions], language);
}

function injectNanoBananaTerms(text, nanoTerms, detail, language) {
  const selectedTerms = Array.isArray(nanoTerms) ? nanoTerms.filter(Boolean) : [];
  if (selectedTerms.length === 0) return text;

  const missing = selectedTerms.filter((term) => !new RegExp(escapeRegExp(term), "i").test(text));
  const limited = detail === "short" ? missing.slice(0, 3) : missing.slice(0, 5);
  if (limited.length === 0) return text;

  const clause =
    language === "en"
      ? detail === "short"
        ? `with ${limited.join(", ")} rendering cues`
        : `enhanced with ${limited.join(", ")} rendering characteristics`
      : detail === "short"
        ? `${limited.join("、")}的渲染质感`
        : `并带有${limited.join("、")}等渲染特征`;

  return mergePromptSegments([text, clause], language);
}

function mergePromptSegments(segments, language = "zh") {
  const filtered = segments.map((item) => cleanSnippet(item)).filter(Boolean);
  if (filtered.length === 0) return "";

  let output = filtered[0];

  for (const segment of filtered.slice(1)) {
    if (/[。！？]$/.test(output)) {
      output = `${output} ${segment}`;
    } else {
      output = language === "en" ? `${output}, ${segment}` : `${output}，${segment}`;
    }
  }

  return output
    .replace(/\s+/g, " ")
    .replace(language === "en" ? /,\s*,/g : /，\s*，/g, language === "en" ? "," : "，")
    .replace(/。\s*。/g, "。")
    .trim();
}

function cleanSnippet(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[，,。；;:：\-\s]+|[，,。；;:：\-\s]+$/g, "")
    .trim();
}

function hasLightingSignals(text) {
  return /(lighting|light|shadow|rim light|side lighting|soft diffusion|hard shadows|cinematic glow|丁达尔|布光|光线|光影|侧光|逆光|轮廓光|自然光|棚拍)/i.test(
    text
  );
}

function hasCameraSignals(text) {
  return /(camera|lens|mm\b|f\/\d|eye-level|eye level|low angle|high angle|shot on|焦段|镜头|机位|仰拍|俯拍|平拍|光圈)/i.test(
    text
  );
}

function hasMaterialSignals(text) {
  return /(texture|material|pores|fabric weave|refraction|subsurface scattering|材质|纹理|肌理|毛孔|折射|次表面散射)/i.test(
    text
  );
}

function hasCompositionSignals(text) {
  return /(composition|rule of thirds|centered|foreground blur|leading lines|构图|景深|前景虚化|引导线|对称|三分法)/i.test(
    text
  );
}

function hasEnvironmentSignals(text) {
  return /(environment|background|spatial|space|scene|环境|背景|空间|场景)/i.test(text);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
