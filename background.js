const DEFAULT_SETTINGS = {
  provider: "gemini",
  apiMode: "direct",
  promptApiKey: "",
  promptModel: "gemini-3.1-pro-preview",
  imageGenerationEnabled: true,
  imageApiKey: "",
  imageModel: "gemini-3.1-flash-image-preview",
  geminiApiKey: "",
  geminiTextModel: "gemini-3.1-pro-preview",
  geminiImageModel: "gemini-3.1-flash-image-preview",
  customProxyUrl: "",
  customProxyToken: "",
  autoAnalyze: true,
  aspectRatio: "1:1",
  imageCount: 1
};
const DEFAULT_PROMPT_MODEL = "gemini-3.1-pro-preview";
const LEGACY_PROMPT_MODEL = "gemini-2.5-flash";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const TEMP_IMAGE_MODEL = "imagen-4.0-generate-001";

const VIEWER_DB_NAME = "image-lens-db";
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
      console.error("[Image Lens]", error);
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
  const merged = { ...DEFAULT_SETTINGS, ...stored };

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

  return merged;
}

async function saveSettings(payload) {
  const next = sanitizeSettings(payload);
  if ("promptApiKey" in next) {
    next.geminiApiKey = next.promptApiKey;
  }
  if ("promptModel" in next) {
    next.geminiTextModel = next.promptModel;
  }
  if ("imageModel" in next) {
    next.geminiImageModel = next.imageModel;
  }
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

  ensurePromptApiKey(settings);

  const imagePart = await fetchImageAsInlineData(imageUrl);
  const prompt = buildAnalyzePrompt(payload);

  const response = await callGeminiGenerateContent({
    apiKey: settings.promptApiKey,
    model: settings.promptModel,
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

  if (!calibrated.analysis?.subject?.main && !calibrated.displayPrompts?.zhShort) {
    throw new Error("Model did not return valid structured analysis.");
  }

  return {
    title: calibrated.title,
    analysis: calibrated.analysis,
    structuredPrompt: calibrated.structuredPrompt,
    keywords: calibrated.keywords,
    drafts: calibrated.drafts,
    displayPrompts: calibrated.displayPrompts,
    enPromptShort: calibrated.displayPrompts.enShort,
    enPromptFull: calibrated.displayPrompts.enFull,
    zhPromptShort: calibrated.displayPrompts.zhShort,
    zhPromptFull: calibrated.displayPrompts.zhFull,
    sourceImageUrl: imageUrl
  };
}

async function generateImage(payload) {
  const settings = await getSettings();
  const prompt = String(payload.prompt || "").trim();
  const shouldOpenViewer = Boolean(payload.openViewer);

  if (!settings.imageGenerationEnabled) {
    throw new Error("生图功能当前已关闭。");
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

  const data = await callGeminiGenerateContent({
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
  const images = extractImagesFromGemini(data);

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
    model: settings.imageModel,
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

function ensurePromptApiKey(settings) {
  if (!settings.promptApiKey) {
    throw new Error("识别图片模型 API Key 尚未配置，请先打开设置页。");
  }
}

function ensureImageApiKey(settings) {
  if (!settings.imageApiKey) {
    throw new Error("生图模型 API Key 尚未配置，请先打开设置页。");
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

async function callGeminiGenerateContent({ apiKey, model, contents, generationConfig }) {
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
      body: JSON.stringify({
        contents,
        ...(generationConfig ? { generationConfig } : {})
      })
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
  const jsonText = extractFirstJsonObject(candidate);

  return JSON.parse(jsonText);
}

function extractFirstJsonObject(text) {
  const source = String(text || "");
  const start = source.indexOf("{");
  if (start < 0) return source;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return source.slice(start);
}

function buildAnalyzePrompt(payload) {
  return [
    "角色设定：你是一位资深视觉导演与图像逆向分析师，擅长将视觉图像拆解为稳定、可编辑、可重组的结构化提示词数据。",
    "核心任务：分析上传图片，提取其核心视觉变量，输出结构化 JSON。目标不是写华丽文案，而是输出稳定、明确、可用于后续程序组装提示词的数据。",
    "总原则：优先还原原图的主体、风格、镜头语言、光线结构、材质质感、构图逻辑和空间关系；尽量填写具体、可观察、可复用的信息，不要写空泛评价。",
    "禁止事项：禁止使用 Beautiful、High quality、Amazing、Stunning、Gorgeous 等空洞形容词；禁止编造品牌、商标、人物真实身份或受版权保护角色名，不确定时使用通用描述。",
    "分析时必须覆盖四个维度：1. Camera & Lens；2. Lighting Setup；3. Material & Texture；4. Compositional Logic。",
    "输出必须是严格合法 JSON，不要 Markdown，不要解释，不要额外前后缀。",
    "structuredPrompt.enFull 是英文完整版提示词主稿，必须按固定顺序输出八个段落，并且每个段落之间只用英文分号 ; 分隔。",
    "structuredPrompt.enFull 的固定顺序和标签必须是：Subject: ...; Style: ...; Lighting: ...; Camera: ...; Environment: ...; Material: ...; Composition: ...; Rendering: ...",
    "structuredPrompt.enFull 必须是纯英文，不能混入中文；每个段落必须写具体内容，不要只写标签。",
    "analysis 是结构化辅助数据，drafts 是附带草稿。",
    "字段要求：",
    "1. title：12 字以内概括主题。",
    "2. analysis.subject.main：主体核心描述。",
    "3. analysis.subject.attributes：主体显著特征数组。",
    "4. analysis.subject.action：主体动作、姿态或状态。",
    "5. analysis.style.medium：媒介，例如摄影、插画、3D、胶片摄影。",
    "6. analysis.style.genre：风格类型，例如电影感人像、时尚大片、电商产品图。",
    "7. analysis.style.mood：整体情绪或氛围。",
    "8. analysis.style.referenceLook：风格参照或设备观感，例如哈苏质感、电影机观感。",
    "9. analysis.camera：拆成 focalLength、aperture、angle、shotType、depthOfField。",
    "10. analysis.lighting：拆成 direction、quality、effect、timeOfDay。",
    "11. analysis.material：拆成 surface、microDetail、opticalProperties 数组。",
    "12. analysis.composition：拆成 layout、subjectPlacement、foreground、background、leadingLines、symmetry。",
    "13. analysis.environment：拆成 sceneType、backgroundMaterial、spatialRelation。",
    "14. analysis.rendering：拆成 priorityTerms、deviceLook、colorGrade。",
    "15. structuredPrompt.zhFull 必须是 structuredPrompt.enFull 的纯中文语义对应版本，也按同样顺序和分号结构输出：主体：...；风格：...；光线：...；镜头：...；环境：...；材质：...；构图：...；渲染：...",
    "16. structuredPrompt.enShort 必须基于 structuredPrompt.enFull 精简，保留主体、风格、光线、镜头、关键材质和构图。",
    "17. structuredPrompt.zhShort 必须基于 structuredPrompt.zhFull 精简，保留主体、风格、光线、镜头、关键材质和构图。",
    "18. keywords：提供 6 到 12 个中文短词。",
    "19. drafts 可复制 structuredPrompt 对应字段。",
    "20. 如果字段缺失，返回空字符串或空数组，不要编造无法观察的细节。",
    "21. 输出前先内部自检：根据 structuredPrompt.enFull 重新生成图片时，是否足以还原原图 90% 的视觉变量；如果不能，请补足缺失段落。",
    'JSON 格式：{"title":"","structuredPrompt":{"enFull":"","enShort":"","zhFull":"","zhShort":""},"analysis":{"subject":{"main":"","attributes":[],"action":""},"style":{"medium":"","genre":"","mood":"","referenceLook":""},"camera":{"focalLength":"","aperture":"","angle":"","shotType":"","depthOfField":""},"lighting":{"direction":"","quality":"","effect":"","timeOfDay":""},"material":{"surface":"","microDetail":"","opticalProperties":[]},"composition":{"layout":"","subjectPlacement":"","foreground":"","background":"","leadingLines":"","symmetry":""},"environment":{"sceneType":"","backgroundMaterial":"","spatialRelation":""},"rendering":{"priorityTerms":[],"deviceLook":[],"colorGrade":""}},"keywords":[],"drafts":{"enShort":"","enFull":"","zhShort":"","zhFull":""}}',
    `补充上下文：页面地址 ${payload.pageUrl || "unknown"}；图片 alt ${payload.alt || "none"}。`
  ].join("\n");
}

function calibratePromptPayload(parsed) {
  const structuredPrompt = normalizeStructuredPrompt(parsed?.structuredPrompt);
  const promptSections = parseStructuredPromptSections(structuredPrompt.enFull);
  const analysis = fillStructuredDefaults(
    mergeAnalysisWithPromptSections(normalizeStructuredAnalysis(parsed?.analysis), promptSections)
  );
  const drafts = normalizeDraftPrompts(parsed?.drafts, parsed, structuredPrompt);
  const keywords = normalizeKeywords(parsed?.keywords, analysis);
  const displayPrompts = composeDisplayPrompts(analysis, drafts, structuredPrompt);

  return {
    title: normalizeTitle(parsed?.title, analysis),
    analysis,
    structuredPrompt,
    keywords,
    drafts,
    displayPrompts
  };
}

function normalizeStructuredAnalysis(input) {
  const source = isPlainObject(input) ? input : {};

  return {
    subject: {
      main: normalizeTextField(source?.subject?.main || source?.subject),
      attributes: normalizeStringArray(source?.subject?.attributes),
      action: normalizeTextField(source?.subject?.action)
    },
    style: {
      medium: normalizeTextField(source?.style?.medium || source?.styleMedium),
      genre: normalizeTextField(source?.style?.genre),
      mood: normalizeTextField(source?.style?.mood),
      referenceLook: normalizeTextField(source?.style?.referenceLook)
    },
    camera: {
      focalLength: normalizeTextField(source?.camera?.focalLength),
      aperture: normalizeTextField(source?.camera?.aperture),
      angle: normalizeTextField(source?.camera?.angle || source?.camera),
      shotType: normalizeTextField(source?.camera?.shotType),
      depthOfField: normalizeTextField(source?.camera?.depthOfField)
    },
    lighting: {
      direction: normalizeTextField(source?.lighting?.direction || source?.lighting),
      quality: normalizeTextField(source?.lighting?.quality),
      effect: normalizeTextField(source?.lighting?.effect),
      timeOfDay: normalizeTextField(source?.lighting?.timeOfDay)
    },
    material: {
      surface: normalizeTextField(source?.material?.surface),
      microDetail: normalizeTextField(source?.material?.microDetail || source?.materialTexture),
      opticalProperties: normalizeStringArray(source?.material?.opticalProperties)
    },
    composition: {
      layout: normalizeTextField(source?.composition?.layout || source?.composition),
      subjectPlacement: normalizeTextField(source?.composition?.subjectPlacement),
      foreground: normalizeTextField(source?.composition?.foreground),
      background: normalizeTextField(source?.composition?.background),
      leadingLines: normalizeTextField(source?.composition?.leadingLines),
      symmetry: normalizeTextField(source?.composition?.symmetry)
    },
    environment: {
      sceneType: normalizeTextField(source?.environment?.sceneType || source?.environment),
      backgroundMaterial: normalizeTextField(source?.environment?.backgroundMaterial),
      spatialRelation: normalizeTextField(source?.environment?.spatialRelation)
    },
    rendering: {
      priorityTerms: normalizeStringArray(source?.rendering?.priorityTerms || source?.nanoBananaTerms),
      deviceLook: normalizeStringArray(source?.rendering?.deviceLook),
      colorGrade: normalizeTextField(source?.rendering?.colorGrade)
    }
  };
}

function fillStructuredDefaults(analysis) {
  const next = normalizeStructuredAnalysis(analysis);

  if (!next.camera.focalLength) next.camera.focalLength = "50mm";
  if (!next.camera.angle) next.camera.angle = "eye-level";
  if (!next.camera.shotType) next.camera.shotType = "medium shot";
  if (!next.camera.depthOfField) next.camera.depthOfField = "natural depth of field";
  if (!next.lighting.direction) next.lighting.direction = "natural side lighting";
  if (!next.lighting.quality) next.lighting.quality = "soft diffusion";
  if (!next.composition.layout) next.composition.layout = "centered composition";
  if (!next.composition.subjectPlacement) next.composition.subjectPlacement = "subject centered";
  if (!next.environment.spatialRelation) {
    next.environment.spatialRelation = "clear separation between subject and background";
  }
  if (!next.rendering.priorityTerms.length) {
    next.rendering.priorityTerms = ["Extreme fidelity", "Global illumination"];
  }

  return next;
}

function normalizeStructuredPrompt(input) {
  const source = isPlainObject(input) ? input : {};

  return {
    enFull: normalizeStructuredPromptText(source.enFull || "", "en"),
    enShort: normalizeEnglishPrompt(source.enShort || "", "short"),
    zhFull: normalizeStructuredPromptText(source.zhFull || "", "zh"),
    zhShort: normalizeChinesePrompt(source.zhShort || "", "short")
  };
}

function normalizeStructuredPromptText(text, language) {
  const orderedLabels = [
    ["subject", "Subject", "主体"],
    ["style", "Style", "风格"],
    ["lighting", "Lighting", "光线"],
    ["camera", "Camera", "镜头"],
    ["environment", "Environment", "环境"],
    ["material", "Material", "材质"],
    ["composition", "Composition", "构图"],
    ["rendering", "Rendering", "渲染"]
  ];
  const sections = new Map();

  String(text || "")
    .split(/[;；]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const match = part.match(/^([^:：]+)\s*[:：]\s*(.+)$/);
      if (!match) return;

      const key = normalizeStructuredLabelKey(match[1]);
      if (!key || sections.has(key)) return;

      const value =
        language === "zh"
          ? normalizeChinesePrompt(match[2], "full")
          : normalizeEnglishPrompt(match[2], "full");
      if (value) sections.set(key, value);
    });

  if (sections.size < 6) {
    return language === "zh" ? normalizeChinesePrompt(text, "full") : normalizeEnglishPrompt(text, "full");
  }

  const separator = language === "zh" ? "；" : "; ";
  return orderedLabels
    .filter(([key]) => sections.has(key))
    .map(([key, enLabel, zhLabel]) => `${language === "zh" ? zhLabel : enLabel}${language === "zh" ? "：" : ": "}${sections.get(key)}`)
    .join(separator);
}

function normalizeStructuredLabelKey(label) {
  const normalized = String(label || "").trim().toLowerCase().replace(/\s+/g, "");

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

function parseStructuredPromptSections(enFullPrompt) {
  const labels = {
    subject: "subject",
    style: "style",
    lighting: "lighting",
    camera: "camera",
    environment: "environment",
    material: "material",
    composition: "composition",
    rendering: "rendering"
  };
  const sections = {};

  String(enFullPrompt || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const match = part.match(/^([A-Za-z ]+)\s*:\s*(.+)$/);
      if (!match) return;

      const label = match[1].trim().toLowerCase();
      const key = labels[label];
      const value = normalizeEnglishPrompt(match[2], "full");
      if (key && value) {
        sections[key] = value;
      }
    });

  return sections;
}

function mergeAnalysisWithPromptSections(analysis, sections) {
  const next = normalizeStructuredAnalysis(analysis);

  if (sections.subject && !next.subject.main) next.subject.main = sections.subject;
  if (sections.style) {
    if (!next.style.medium) next.style.medium = sections.style;
    if (!next.style.genre) next.style.genre = sections.style;
  }
  if (sections.lighting && !next.lighting.direction) next.lighting.direction = sections.lighting;
  if (sections.camera && !next.camera.angle) next.camera.angle = sections.camera;
  if (sections.environment && !next.environment.sceneType) next.environment.sceneType = sections.environment;
  if (sections.material && !next.material.microDetail) next.material.microDetail = sections.material;
  if (sections.composition && !next.composition.layout) next.composition.layout = sections.composition;
  if (sections.rendering && next.rendering.priorityTerms.length === 0) {
    next.rendering.priorityTerms = normalizeStringArray(sections.rendering);
  }

  return next;
}

function normalizeDraftPrompts(draftsInput, legacyInput, structuredPrompt = {}) {
  const drafts = isPlainObject(draftsInput) ? draftsInput : {};

  return {
    enShort: normalizeEnglishPrompt(
      drafts.enShort || structuredPrompt.enShort || legacyInput?.enPromptShort || "",
      "short"
    ),
    enFull: normalizeEnglishPrompt(drafts.enFull || structuredPrompt.enFull || legacyInput?.enPromptFull || "", "full"),
    zhShort: normalizeChinesePrompt(
      drafts.zhShort || structuredPrompt.zhShort || legacyInput?.zhPromptShort || "",
      "short"
    ),
    zhFull: normalizeChinesePrompt(drafts.zhFull || structuredPrompt.zhFull || legacyInput?.zhPromptFull || "", "full")
  };
}

function composePromptsFromAnalysis(analysis) {
  return {
    zhShort: composeChineseShortPrompt(analysis),
    zhFull: composeChineseFullPrompt(analysis),
    enShort: composeEnglishShortPrompt(analysis),
    enFull: composeEnglishFullPrompt(analysis)
  };
}

function composeDisplayPrompts(analysis, drafts, structuredPrompt = {}) {
  const composed = composePromptsFromAnalysis(analysis);
  const zhFull = choosePrompt(structuredPrompt.zhFull || drafts.zhFull, composed.zhFull);
  const zhShort = choosePrompt(
    structuredPrompt.zhShort || drafts.zhShort,
    createChineseShortFromFull(zhFull, composed.zhShort)
  );
  const enFull = chooseEnglishPrompt(structuredPrompt.enFull || drafts.enFull, composed.enFull, "full");

  return {
    zhFull: stripPromptSectionLabels(zhFull),
    zhShort: expandChineseShortPrompt(stripPromptSectionLabels(zhShort), zhFull),
    enFull: stripPromptSectionLabels(enFull),
    enShort: stripPromptSectionLabels(
      chooseEnglishPrompt(
        structuredPrompt.enShort || drafts.enShort,
        createEnglishShortFromFull(enFull, composed.enShort),
        "short"
      )
    )
  };
}

function choosePrompt(primary, fallback = "") {
  const normalized = String(primary || "").trim();
  if (normalized) return normalized;
  return String(fallback || "").trim();
}

function stripPromptSectionLabels(prompt) {
  const labelPattern =
    /(?:^|[;；。]\s*)(?:Subject|Style|Lighting|Camera|Environment|Material|Composition|Rendering|主体(?:描述|内容)?|风格(?:与媒介|媒介|类型)?|光(?:线|影)?(?:设置|布局)?|镜头(?:语言|参数)?|环境(?:空间)?|材质(?:细节|纹理)?|构图(?:逻辑|关系)?|渲染(?:特征|质感)?)\s*[：:]\s*/gi;

  return String(prompt || "")
    .replace(labelPattern, "；")
    .split(/[;；]/)
    .map((part) =>
      part
        .trim()
        .replace(/^(?:Subject|Style|Lighting|Camera|Environment|Material|Composition|Rendering)\s*[:：]\s*/i, "")
        .replace(
          /^(?:主体(?:描述|内容)?|风格(?:与媒介|媒介|类型)?|光(?:线|影)?(?:设置|布局)?|镜头(?:语言|参数)?|环境(?:空间)?|材质(?:细节|纹理)?|构图(?:逻辑|关系)?|渲染(?:特征|质感)?)\s*[：:]\s*/,
          ""
        )
        .trim()
    )
    .filter(Boolean)
    .join("；");
}

function expandChineseShortPrompt(shortPrompt, fullPrompt) {
  const targetLength = 100;
  const maxLength = 130;
  let normalized = normalizeChinesePrompt(shortPrompt, "full");
  if (countChineseCharacters(normalized) >= 88) {
    return normalizeChinesePunctuation(normalized);
  }

  const clauses = normalizeChinesePrompt(fullPrompt, "full")
    .split(/[，。；]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const patterns = [
    /(主体|一个|一位|人物|产品|物体|场景|女孩|男孩|女性|男性|人像|角色)/,
    /(摄影|插画|3D|CG|电影|胶片|写实|风格|质感|氛围)/,
    /(光|侧光|逆光|柔光|硬光|阴影|轮廓光|自然光|棚拍|光感)/,
    /(镜头|毫米|mm|f\/|平视|仰拍|俯拍|特写|半身|全身|景深)/,
    /(材质|纹理|肌理|毛孔|织物|玻璃|金属|皮肤|细节|光滑)/,
    /(构图|居中|三分法|前景|背景|层次|空间|虚化)/
  ];

  for (const pattern of patterns) {
    const clause = clauses.find((item) => pattern.test(item) && !normalized.includes(item));
    if (!clause) continue;

    const candidate = normalized ? `${normalized}，${clause}` : clause;
    if (countChineseCharacters(candidate) > maxLength) continue;
    normalized = candidate;

    if (countChineseCharacters(normalized) >= targetLength) break;
  }

  return normalizeChinesePunctuation(normalized);
}

function countChineseCharacters(text) {
  const matches = String(text || "").match(/[\u4e00-\u9fff]/g);
  return matches ? matches.length : 0;
}

function chooseEnglishPrompt(primary, fallback = "", detail = "full") {
  const normalized = normalizeEnglishPrompt(primary, detail);
  if (isUsableEnglishPrompt(normalized)) return normalized;

  const fallbackPrompt = normalizeEnglishPrompt(fallback, detail);
  if (isUsableEnglishPrompt(fallbackPrompt)) return fallbackPrompt;

  return getFallbackEnglishPrompt(detail);
}

function createChineseShortFromFull(fullPrompt, fallback = "") {
  const source = normalizeChinesePrompt(fullPrompt || fallback, "full");
  if (!source) return normalizeChinesePrompt(fallback, "short");

  const clauses = source
    .split(/[，。；]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const required = [];
  const patterns = [
    /(主体|一个|一位|人物|产品|物体|场景|女孩|男孩|女性|男性|人像|角色)/,
    /(摄影|插画|3D|CG|电影|胶片|写实|风格|质感)/,
    /(光|侧光|逆光|柔光|硬光|阴影|轮廓光|自然光|棚拍)/,
    /(镜头|毫米|mm|f\/|平视|仰拍|俯拍|特写|半身|全身|景深)/,
    /(材质|纹理|肌理|毛孔|织物|玻璃|金属|皮肤|细节)/,
    /(构图|居中|三分法|前景|背景|层次|空间)/
  ];

  for (const pattern of patterns) {
    const match = clauses.find((clause) => pattern.test(clause) && !required.includes(clause));
    if (match) required.push(match);
  }

  const compact = required.length > 0 ? required.join("，") : clauses.slice(0, 7).join("，");
  return normalizeChinesePrompt(compact, "short");
}

function createEnglishShortFromFull(fullPrompt, fallback = "") {
  const source = normalizeEnglishPrompt(fullPrompt || fallback, "full");
  if (!source) return normalizeEnglishPrompt(fallback, "short");

  const sentences = source
    .split(/[.!?]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const compact = sentences.slice(0, 2).join(". ");
  return normalizeEnglishPrompt(compact || source, "short");
}

function isUsableEnglishPrompt(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  if (/[\u4e00-\u9fff]/.test(normalized)) return false;
  if (/,{2,}|\.{2,}/.test(normalized)) return false;

  const words = normalized.match(/[A-Za-z][A-Za-z-]*/g) || [];
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  return normalized.length >= 40 && words.length >= 8 && uniqueWords.size >= 6;
}

function getFallbackEnglishPrompt(detail) {
  return detail === "short"
    ? "Detailed subject with defined visual style, controlled lighting, clear camera perspective, visible material detail, and balanced composition."
    : "Detailed subject rendering with a defined visual style, controlled physical lighting, clear camera perspective, natural depth of field, visible material texture, balanced composition, and high-fidelity rendering characteristics.";
}

function normalizeTitle(input, analysis) {
  const title = normalizeTextField(input);
  if (title) return title.slice(0, 12);
  return normalizeTextField(analysis?.subject?.main).slice(0, 12) || "图片提示词";
}

function normalizeKeywords(input, analysis) {
  const list = normalizeStringArray(input);
  const fallbacks = [
    analysis.subject.main,
    ...analysis.subject.attributes,
    analysis.subject.action,
    analysis.style.medium,
    analysis.style.genre,
    analysis.lighting.direction,
    analysis.lighting.quality,
    analysis.camera.focalLength,
    analysis.camera.angle,
    analysis.composition.layout,
    ...analysis.rendering.priorityTerms
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

function composeChineseShortPrompt(analysis) {
  return finalizeZhPrompt(
    joinZhCompact([
      composeSubjectZh(analysis.subject),
      composeStyleShortZh(analysis.style),
      composeLightingShortZh(analysis.lighting),
      composeCameraShortZh(analysis.camera),
      composeMaterialShortZh(analysis.material),
      composeCompositionShortZh(analysis.composition)
    ]),
    "short"
  );
}

function composeChineseFullPrompt(analysis) {
  return finalizeZhPrompt(
    joinZhExpanded([
      composeSubjectZh(analysis.subject),
      composeStyleFullZh(analysis.style),
      composeLightingFullZh(analysis.lighting),
      composeCameraFullZh(analysis.camera),
      composeEnvironmentZh(analysis.environment),
      composeMaterialZh(analysis.material),
      composeCompositionFullZh(analysis.composition),
      composeRenderingZh(analysis.rendering)
    ]),
    "full"
  );
}

function composeEnglishShortPrompt(analysis) {
  return finalizeEnPrompt(
    joinEnCompact(
      [
        composeSubjectEn(analysis.subject),
        composeStyleShortEn(analysis.style),
        composeLightingShortEn(analysis.lighting),
        composeCameraShortEn(analysis.camera),
        composeMaterialShortEn(analysis.material),
        composeCompositionShortEn(analysis.composition)
      ],
      analysis
    ),
    "short"
  );
}

function composeEnglishFullPrompt(analysis) {
  return finalizeEnPrompt(
    joinEnExpanded(
      [
        composeSubjectEn(analysis.subject),
        composeStyleFullEn(analysis.style),
        composeLightingFullEn(analysis.lighting),
        composeCameraFullEn(analysis.camera),
        composeEnvironmentEn(analysis.environment),
        composeMaterialEn(analysis.material),
        composeCompositionFullEn(analysis.composition),
        composeRenderingEn(analysis.rendering)
      ],
      analysis
    ),
    "full"
  );
}

function composeSubjectZh(subject) {
  return [subject.main, ...subject.attributes, subject.action].filter(Boolean).join("，");
}

function composeStyleShortZh(style) {
  return [style.medium, style.genre].filter(Boolean).join("，");
}

function composeStyleFullZh(style) {
  return [
    style.medium && `整体采用${style.medium}表现`,
    style.genre && `风格偏向${style.genre}`,
    style.mood && `氛围呈现${style.mood}`,
    style.referenceLook && `整体观感接近${style.referenceLook}`
  ]
    .filter(Boolean)
    .join("，");
}

function composeLightingShortZh(lighting) {
  return [lighting.direction, lighting.quality].filter(Boolean).join("，");
}

function composeLightingFullZh(lighting) {
  return [
    lighting.direction && `光线方向为${lighting.direction}`,
    lighting.quality && `光质呈现${lighting.quality}`,
    lighting.effect && `带有${lighting.effect}`,
    lighting.timeOfDay && `整体光感接近${lighting.timeOfDay}`
  ]
    .filter(Boolean)
    .join("，");
}

function composeCameraShortZh(camera) {
  return [camera.focalLength, camera.angle, camera.shotType].filter(Boolean).join("，");
}

function composeCameraFullZh(camera) {
  return [
    camera.focalLength && `${camera.focalLength}镜头`,
    camera.aperture,
    camera.angle,
    camera.shotType,
    camera.depthOfField
  ]
    .filter(Boolean)
    .join("，");
}

function composeEnvironmentZh(environment) {
  return [
    environment.sceneType && `场景为${environment.sceneType}`,
    environment.backgroundMaterial && `背景材质呈现${environment.backgroundMaterial}`,
    environment.spatialRelation && `空间关系表现为${environment.spatialRelation}`
  ]
    .filter(Boolean)
    .join("，");
}

function composeMaterialZh(material) {
  return [
    material.surface && `表面材质呈现${material.surface}`,
    material.microDetail && `细节强调${material.microDetail}`,
    material.opticalProperties.length && `光学特性包含${material.opticalProperties.join("、")}`
  ]
    .filter(Boolean)
    .join("，");
}

function composeCompositionShortZh(composition) {
  return [composition.layout].filter(Boolean).join("，");
}

function composeMaterialShortZh(material) {
  return [material.surface, material.microDetail].filter(Boolean).join("，");
}

function composeCompositionFullZh(composition) {
  return [
    composition.layout && `构图采用${composition.layout}`,
    composition.subjectPlacement && `主体位置为${composition.subjectPlacement}`,
    composition.foreground && `前景处理为${composition.foreground}`,
    composition.background && `背景处理为${composition.background}`,
    composition.leadingLines && `画面引导线体现为${composition.leadingLines}`,
    composition.symmetry && `对称关系表现为${composition.symmetry}`
  ]
    .filter(Boolean)
    .join("，");
}

function composeRenderingZh(rendering) {
  return [
    rendering.colorGrade && `调色倾向为${rendering.colorGrade}`,
    rendering.deviceLook.length && `影像观感接近${rendering.deviceLook.join("、")}`,
    rendering.priorityTerms.length &&
      `可强化${rendering.priorityTerms.map(mapNanoTermToChinese).join("、")}等渲染特征`
  ]
    .filter(Boolean)
    .join("，");
}

function composeSubjectEn(subject) {
  return [subject.main, ...subject.attributes, subject.action].filter(Boolean).join(", ");
}

function composeStyleShortEn(style) {
  return [style.medium, style.genre, style.mood].filter(Boolean).join(", ");
}

function composeStyleFullEn(style) {
  return [style.medium, style.genre, style.mood, style.referenceLook].filter(Boolean).join(", ");
}

function composeLightingShortEn(lighting) {
  return [lighting.direction, lighting.quality].filter(Boolean).join(", ");
}

function composeLightingFullEn(lighting) {
  return [lighting.direction, lighting.quality, lighting.effect, lighting.timeOfDay]
    .filter(Boolean)
    .join(", ");
}

function composeCameraShortEn(camera) {
  return [camera.focalLength && `${camera.focalLength} lens`, camera.angle, camera.shotType]
    .filter(Boolean)
    .join(", ");
}

function composeCameraFullEn(camera) {
  return [
    camera.focalLength && `${camera.focalLength} lens`,
    camera.aperture,
    camera.angle,
    camera.shotType,
    camera.depthOfField
  ]
    .filter(Boolean)
    .join(", ");
}

function composeEnvironmentEn(environment) {
  return [environment.sceneType, environment.backgroundMaterial, environment.spatialRelation]
    .filter(Boolean)
    .join(", ");
}

function composeMaterialEn(material) {
  return [material.surface, material.microDetail, ...material.opticalProperties].filter(Boolean).join(", ");
}

function composeCompositionShortEn(composition) {
  return [composition.layout, composition.subjectPlacement].filter(Boolean).join(", ");
}

function composeMaterialShortEn(material) {
  return [material.surface, material.microDetail].filter(Boolean).join(", ");
}

function composeCompositionFullEn(composition) {
  return [
    composition.layout,
    composition.subjectPlacement,
    composition.foreground,
    composition.background,
    composition.leadingLines,
    composition.symmetry
  ]
    .filter(Boolean)
    .join(", ");
}

function composeRenderingEn(rendering) {
  return [rendering.colorGrade, ...rendering.deviceLook, ...rendering.priorityTerms]
    .filter(Boolean)
    .join(", ");
}

function joinZhCompact(parts) {
  return parts.filter(Boolean).join("，");
}

function joinZhExpanded(parts) {
  return parts.filter(Boolean).join("。");
}

function joinEnCompact(parts, analysis) {
  const filtered = parts.filter(Boolean);
  if (filtered.length === 0) return "";

  const sentenceOne = [
    composeSubjectEn(analysis.subject),
    composeStyleShortEn(analysis.style)
  ]
    .filter(Boolean)
    .join(", ");

  const sentenceTwo = [
    composeLightingShortEn(analysis.lighting),
    composeCameraShortEn(analysis.camera),
    composeMaterialShortEn(analysis.material),
    composeCompositionShortEn(analysis.composition)
  ]
    .filter(Boolean)
    .join(", ");

  return [sentenceOne, sentenceTwo].filter(Boolean).join(". ");
}

function joinEnExpanded(parts, analysis) {
  const sentenceOne = [
    composeSubjectEn(analysis.subject),
    composeStyleFullEn(analysis.style)
  ]
    .filter(Boolean)
    .join(", ");

  const sentenceTwo = [
    composeLightingFullEn(analysis.lighting),
    composeCameraFullEn(analysis.camera),
    composeEnvironmentEn(analysis.environment)
  ]
    .filter(Boolean)
    .join(", ");

  const sentenceThree = [
    composeMaterialEn(analysis.material),
    composeCompositionFullEn(analysis.composition),
    composeRenderingEn(analysis.rendering)
  ]
    .filter(Boolean)
    .join(", ");

  return [sentenceOne, sentenceTwo, sentenceThree].filter(Boolean).join(". ");
}

function finalizeZhPrompt(text, detail) {
  return normalizeChinesePrompt(text, detail).trim();
}

function finalizeEnPrompt(text, detail) {
  return normalizeEnglishPrompt(text, detail).trim();
}

function normalizeTextField(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[，,。；;:：\-\s]+|[，,。；;:：\-\s]+$/g, "")
    .trim();
}

function normalizeStringArray(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? splitLooseList(value)
      : [];

  return Array.from(new Set(list.map(normalizeTextField).filter(Boolean)));
}

function splitLooseList(value) {
  return String(value || "")
    .split(/[，,、;；|/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizeEnglishPrompt(text, detail) {
  let normalized = String(text || "");
  const replacements = [
    [/主体/g, "subject"],
    [/风格/g, "style"],
    [/媒介/g, "medium"],
    [/光线/g, "lighting"],
    [/镜头/g, "lens"],
    [/机位/g, "camera angle"],
    [/环境/g, "environment"],
    [/空间关系/g, "spatial relationship"],
    [/材质/g, "material"],
    [/纹理/g, "texture"],
    [/构图/g, "composition"],
    [/层次/g, "layering"],
    [/景深/g, "depth of field"],
    [/平视/g, "eye-level"],
    [/仰拍/g, "low-angle shot"],
    [/俯拍/g, "high-angle shot"],
    [/低机位/g, "low angle"],
    [/高机位/g, "high angle"],
    [/侧光/g, "side lighting"],
    [/轮廓光/g, "rim light"],
    [/逆光/g, "backlighting"],
    [/柔和漫射/g, "soft diffusion"],
    [/硬阴影/g, "hard shadows"],
    [/自然光/g, "natural light"],
    [/体积雾/g, "volumetric fog"],
    [/全局光照/g, "global illumination"],
    [/光线追踪反射/g, "ray-traced reflections"],
    [/次表面散射/g, "subsurface scattering"],
    [/电影级调色/g, "cinematic color grading"],
    [/青橙色调/g, "teal and orange palette"],
    [/变形宽银幕光晕/g, "anamorphic lens flares"],
    [/哈苏质感/g, "Hasselblad look"],
    [/阿莱电影机质感/g, "ARRI Alexa cinema camera look"],
    [/毫米/g, "mm"]
  ];

  for (const [pattern, value] of replacements) {
    normalized = normalized.replace(pattern, value);
  }

  normalized = normalized
    .replace(/[，、]/g, ", ")
    .replace(/[；]/g, "; ")
    .replace(/[：]/g, ": ")
    .replace(/。/g, ". ")
    .replace(/([^a-zA-Z])f(\d)/g, "$1f/$2")
    .replace(/(\d+)\s*毫米/g, "$1mm")
    .replace(/[\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/(?:\.\s*){2,}/g, ". ")
    .replace(/(?:;\s*){2,}/g, "; ")
    .replace(/,\s*\./g, ".")
    .replace(/\.\s*,/g, ".")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:])(?=\S)/g, "$1 ")
    .replace(/^[,.;:\s]+|[,;:\s]+$/g, "")
    .trim();

  if (detail === "short") {
    normalized = normalized
      .split(/[.!?]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(". ");
    if (normalized && !/[.!?]$/.test(normalized)) {
      normalized += ".";
    }
  }

  if (!normalized) {
    return detail === "short"
      ? "Detailed subject, cinematic lighting, controlled camera perspective."
      : "Detailed subject rendering, cinematic lighting, deliberate camera perspective, realistic material texture, and layered environmental depth.";
  }

  return normalized;
}

function normalizeChinesePrompt(text, detail) {
  let normalized = String(text || "");
  const replacements = [
    [/\b(\d+)mm\b/gi, "$1毫米"],
    [/\beye-?level\b/gi, "平视"],
    [/\blow angle\b/gi, "低机位仰拍"],
    [/\bhigh angle\b/gi, "高机位俯拍"],
    [/\bsoft diffusion\b/gi, "柔和漫射"],
    [/\bside lighting\b/gi, "侧光"],
    [/\brim light\b/gi, "轮廓光"],
    [/\bhard shadows?\b/gi, "硬阴影"],
    [/\bglobal illumination\b/gi, "全局光照"],
    [/\bvolumetric fog\b/gi, "体积雾"],
    [/\bray-traced reflections?\b/gi, "光线追踪反射"],
    [/\bsubsurface scattering\b/gi, "次表面散射"],
    [/\bcolor graded for cinema\b/gi, "电影级调色"],
    [/\bteal and orange palette\b/gi, "青橙色调"],
    [/\banamorphic lens flares?\b/gi, "变形宽银幕光晕"],
    [/\bshot on hasselblad\b/gi, "哈苏质感"],
    [/\barri alexa cinema camera\b/gi, "阿莱电影机质感"]
  ];

  for (const [pattern, value] of replacements) {
    normalized = normalized.replace(pattern, value);
  }

  normalized = normalized
    .replace(/([^a-zA-Z])f(\d)/g, "$1f/$2")
    .replace(/([A-Za-z])\s*版/g, "$1版")
    .replace(/\b([A-Za-z])\s+([A-Za-z])\b/g, "$1$2")
    .replace(/\b([A-Za-z])\b(?=版)/g, "$1")
    .replace(
      /\b(?:Subject|Style|Lighting|Camera|Environment|Material|Composition|Rendering)\s*[:：]\s*/gi,
      ""
    )
    .replace(
      /(?:^|[；;。]\s*)(?:主体(?:描述|内容)?|风格(?:与媒介|媒介|类型)?|光(?:线|影)?(?:设置|布局)?|镜头(?:语言|参数)?|环境(?:空间)?|材质(?:细节|纹理)?|构图(?:逻辑|关系)?|渲染(?:特征|质感)?)\s*[：:]\s*/g,
      "；"
    )
    .replace(/\s+/g, " ")
    .replace(/[，,]\s*[，,]/g, "，")
    .replace(/。+/g, "。")
    .trim();

  if (detail === "short") {
    normalized = compressChineseShortPrompt(normalized);
  }

  return normalizeChinesePunctuation(normalized);
}

function compressChineseShortPrompt(text) {
  let normalized = String(text || "")
    .replace(/整体采用/g, "")
    .replace(/的风格与媒介表现/g, "")
    .replace(/镜头语言与拍摄方式体现为/g, "")
    .replace(/环境与空间关系呈现为/g, "")
    .replace(/光线以/g, "")
    .replace(/为主/g, "")
    .replace(/并带有[^。]+等渲染特征/g, "")
    .trim();

  const sentences = normalized
    .split(/[。！？]/)
    .map((item) => item.replace(/^[，、\s]+|[，、\s]+$/g, ""))
    .filter(Boolean);

  let compact = sentences.slice(0, 2).join("。");
  if (compact && !/[。！？]$/.test(compact)) {
    compact += "。";
  }

  if (compact.length > 120) {
    compact = compact
      .split("，")
      .slice(0, 7)
      .join("，");
    if (compact && !/[。！？]$/.test(compact)) {
      compact += "。";
    }
  }

  return compact || normalized;
}

function mapNanoTermToChinese(term) {
  const dictionary = {
    "Extreme fidelity": "极高保真度",
    "Ray-traced reflections": "光线追踪反射",
    "Volumetric fog": "体积雾",
    "Global illumination": "全局光照",
    "Color graded for cinema": "电影级调色",
    "Teal and orange palette": "青橙色调",
    "Subsurface scattering": "次表面散射",
    "Shot on Hasselblad": "哈苏质感",
    "ARRI Alexa Cinema Camera": "阿莱电影机质感",
    "Anamorphic lens flares": "变形宽银幕光晕"
  };

  return dictionary[term] || term;
}

function normalizeChinesePunctuation(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/【\s*】/g, "")
    .replace(/《\s*》/g, "")
    .replace(/「\s*」/g, "")
    .replace(/『\s*』/g, "")
    .replace(/[,.]+/g, "，")
    .replace(/[;；]+/g, "；")
    .replace(/[:：]+/g, "：")
    .replace(/[!?！？]+/g, "。")
    .replace(/、{2,}/g, "、")
    .replace(/([，、；：]){2,}/g, "$1")
    .replace(/([，、；：])(?=。)/g, "")
    .replace(/。([，、；：])/g, "。")
    .replace(/([，、；：])(?=[，、；：])/g, "")
    .replace(/。{2,}/g, "。")
    .replace(/\s*([，。；：、])/g, "$1")
    .replace(/([，；：、])\s*/g, "$1")
    .replace(/[（(]\s*([，。；：、])/g, "$1")
    .replace(/([，。；：、])\s*[）)]/g, "$1")
    .replace(/[（(]([^（）()]*)[）)]/g, (_, inner) => {
      const cleaned = String(inner || "").trim();
      return cleaned ? `（${cleaned}）` : "";
    })
    .replace(/^([，；：、。]+)/g, "")
    .replace(/([，；：、]+)$/g, "")
    .trim();
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
