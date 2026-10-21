// Reverse-prompting: what the analysis model is asked to return, and how its
// answer is read back. The model does the describing and translating; this
// file only checks shape and tidies whitespace. Nothing here invents content
// the model did not write.

// Order matters: it is the order of the structure view and of the full prompt.
export const SECTION_KEYS = [
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

const MAX_KEYWORDS = 10;
const MAX_KEYWORD_LENGTH = 32;

export function buildAnalysisInstructions({ includeChinese = true } = {}) {
  const languageRules = includeChinese
    ? [
        "Every field has an English (en) and a Simplified Chinese (zh) version. Write the English first, then make each zh field a faithful, natural Chinese version of its en field with the same content and detail, not a summary.",
        "- prompt.zh.full: about 150-280 Chinese characters. prompt.zh.short: about 40-80 Chinese characters.",
        "- keywords.zh: natural Chinese terms of 2-6 characters, in the same order as keywords.en.",
        "- title.zh: at most 12 Chinese characters.",
        "- In zh fields keep numbers, units and lens values as written (85mm, f/1.8) and keep quoted on-image text unchanged."
      ]
    : ["Return English only. Leave out every zh field."];

  return [
    "You reverse-engineer images into prompts for text-to-image models such as Gemini image models, GPT Image, Midjourney, Flux and Stable Diffusion.",
    "Study the image and describe only what is actually visible, so that someone who has never seen it could regenerate a close match from your prompt.",
    "",
    "Rules:",
    "- Be concrete: name objects, materials, counts, positions and relative sizes. Name colors precisely (\"muted teal\", \"warm amber\"), not just \"blue\" or \"red\".",
    "- Do not invent details you cannot see. If a section does not apply (for example camera for a flat vector illustration), describe the closest equivalent such as viewpoint and framing, or return an empty string.",
    "- People: describe apparent age range, build, hair, clothing, pose, expression and gaze. Never name or identify real people, characters, brands, logos or artists; describe them generically.",
    "- Text in the image: copy legible text exactly inside double quotes and describe its lettering style, color and position. Keep it in its original language in every version.",
    "- Lens and aperture are estimates. Mention them only when the image shows clear optical cues (background blur, compression, distortion).",
    "- No praise or quality boilerplate: never write beautiful, stunning, masterpiece, best quality, 8k, ultra detailed, trending, award-winning.",
    "- Prompts are natural descriptive language: no tag lists, no field labels such as \"Subject:\".",
    "",
    "Fields:",
    "- sections: one or two precise sentences each.",
    "  subject: who or what, appearance, action, pose.",
    "  environment: setting, background, props, time of day, weather.",
    "  style: medium and genre (photograph, 3D render, watercolor, anime, product shot...), era or movement.",
    "  lighting: direction, hard or soft, color temperature, notable effects such as rim light or haze.",
    "  color: overall palette, dominant and accent colors, contrast, saturation, grading.",
    "  camera: shot size, camera angle, lens look, depth of field, focus.",
    "  composition: framing, subject placement, foreground and background layers, leading lines, negative space, orientation.",
    "  material: key textures and surface details.",
    "  rendering: finish and post-processing such as film grain, bloom, sharpness, noise, print texture.",
    "- prompt.en.full: one flowing paragraph of 80-160 words combining all sections in this order: subject and action, environment, style, lighting, color, camera and composition, materials and finish. It must work on its own as a complete prompt.",
    "- prompt.en.short: one or two sentences, 25-45 words, keeping the subject, style, lighting, palette and the single most distinctive detail.",
    "- keywords.en: 6-10 short tags of 1-3 words for the most distinctive traits of this image, most important first. No generic tags such as photo, image, high quality.",
    "- title.en: 2-6 words naming the image.",
    ...languageRules,
    "",
    "Reply with JSON only, in this shape:",
    JSON.stringify(buildExampleShape({ includeChinese }))
  ].join("\n");
}

// Optional hints sent with the image. Alt text is often wrong or missing, so
// the model is told to treat it as a hint only.
export function buildAnalysisRequestText({ alt = "" } = {}) {
  const lines = ["Analyze this image and return the JSON."];
  const cleanAlt = cleanText(alt).slice(0, 300);
  if (cleanAlt) {
    lines.push(`The page's alt text for it, which may be inaccurate: "${cleanAlt}"`);
  }
  return lines.join("\n");
}

function buildExampleShape({ includeChinese }) {
  const pair = () => (includeChinese ? { en: "", zh: "" } : { en: "" });
  const prompt = { full: "", short: "" };
  return {
    sections: Object.fromEntries(SECTION_KEYS.map((key) => [key, pair()])),
    prompt: includeChinese ? { en: prompt, zh: { ...prompt } } : { en: prompt },
    keywords: includeChinese ? { en: [], zh: [] } : { en: [] },
    title: pair()
  };
}

// Gemini responseSchema (OpenAPI subset). Sections come first so the model
// describes the image before it writes the prompts built from that description.
export function buildGeminiResponseSchema({ includeChinese = true } = {}) {
  const languages = includeChinese ? ["en", "zh"] : ["en"];
  const text = { type: "STRING" };
  const objectOf = (properties) => ({
    type: "OBJECT",
    properties,
    required: Object.keys(properties),
    propertyOrdering: Object.keys(properties)
  });
  const perLanguage = (value) => objectOf(Object.fromEntries(languages.map((language) => [language, value])));

  return objectOf({
    sections: objectOf(Object.fromEntries(SECTION_KEYS.map((key) => [key, perLanguage(text)]))),
    prompt: perLanguage(objectOf({ full: text, short: text })),
    keywords: perLanguage({ type: "ARRAY", items: text }),
    title: perLanguage(text)
  });
}

// Reads the model's JSON into the shape the panel uses. Returns null when the
// answer holds no usable prompt at all.
export function normalizeAnalysisResult(raw, { includeChinese = true } = {}) {
  if (!isPlainObject(raw)) return null;

  const languages = includeChinese ? ["en", "zh"] : ["en"];
  const sections = Object.fromEntries(
    SECTION_KEYS.map((key) => [key, readPerLanguage(raw.sections?.[key], languages)])
  );

  const prompts = { full: {}, short: {} };
  const keywords = {};
  const title = readPerLanguage(raw.title, languages);
  for (const language of languages) {
    const promptSource = raw.prompt?.[language];
    const full = cleanText(promptSource?.full) || composeFromSections(sections, language, SECTION_KEYS);
    const short =
      cleanText(promptSource?.short) || composeFromSections(sections, language, ["subject", "style", "lighting", "color"]);
    prompts.full[language] = full;
    prompts.short[language] = short;
    keywords[language] = cleanKeywords(raw.keywords?.[language]);
  }

  if (!prompts.full.en) return null;

  return {
    title,
    sections,
    prompts,
    keywords,
    // Languages the model actually filled in; the panel hides the others.
    languages: languages.filter((language) => prompts.full[language])
  };
}

function readPerLanguage(value, languages) {
  // Tolerates a plain string where a { en, zh } object was expected.
  if (typeof value === "string") {
    return Object.fromEntries(languages.map((language) => [language, language === "en" ? cleanText(value) : ""]));
  }
  return Object.fromEntries(languages.map((language) => [language, cleanText(value?.[language])]));
}

function composeFromSections(sections, language, keys) {
  const separator = language === "zh" ? "；" : " ";
  return keys
    .map((key) => sections[key]?.[language])
    .filter(Boolean)
    .join(separator);
}

function cleanKeywords(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，、;；\n]/) : [];
  const seen = new Set();
  const result = [];

  for (const item of list) {
    const keyword = cleanText(item).replace(/^#+/, "").replace(/[.。]+$/, "");
    const key = keyword.toLowerCase();
    if (!keyword || keyword.length > MAX_KEYWORD_LENGTH || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
    if (result.length === MAX_KEYWORDS) break;
  }

  return result;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Models in plain JSON mode sometimes wrap the object in a code fence, add a
// sentence around it, or leave a trailing comma. Anything worse is an error.
export function parseLooseJson(rawText) {
  if (!rawText) return null;

  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : rawText;
  const jsonText = extractFirstJsonObject(candidate);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const repaired = removeTrailingCommas(jsonText);
    if (repaired !== jsonText) {
      return JSON.parse(repaired);
    }
    throw error;
  }
}

function removeTrailingCommas(jsonText) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < jsonText.length; index += 1) {
    const char = jsonText[index];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += char;
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      result += char;
      inString = !inString;
      continue;
    }
    if (!inString && char === ",") {
      let next = index + 1;
      while (/\s/.test(jsonText[next] || "")) next += 1;
      if (jsonText[next] === "}" || jsonText[next] === "]") continue;
    }
    result += char;
  }

  return result.trim();
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

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return source.slice(start);
}
