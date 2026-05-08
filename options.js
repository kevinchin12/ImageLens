const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const docButton = document.getElementById("open-doc");
const imageGenerationEnabledField = document.querySelector('[name="imageGenerationEnabled"]');
const imageSettingsGroup = document.getElementById("image-settings-group");

init();

async function init() {
  if (!hasExtensionRuntime()) {
    setStandaloneMode();
    return;
  }

  try {
    const settings = await sendMessage({ type: "get-settings" });
    hydrateForm(settings);
    statusEl.textContent = "设置已载入。";
  } catch (error) {
    statusEl.textContent = error.message || "读取设置失败。";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!hasExtensionRuntime()) {
    statusEl.textContent = "请从 Chrome 扩展的设置页打开，不要直接打开本地 options.html 文件。";
    return;
  }

  const formData = new FormData(form);
  const payload = {
    provider: "gemini",
    apiMode: "direct",
    promptApiKey: formData.get("promptApiKey"),
    promptModel: formData.get("promptModel"),
    imageGenerationEnabled: getField("imageGenerationEnabled")?.checked || false,
    imageApiKey: formData.get("imageApiKey"),
    imageModel: formData.get("imageModel"),
    customProxyUrl: "",
    customProxyToken: "",
    autoAnalyze: getField("autoAnalyze")?.checked || false
  };

  try {
    statusEl.textContent = "保存中...";
    const saved = await sendMessage({ type: "save-settings", payload });
    hydrateForm(saved);
    statusEl.textContent = "设置已保存。";
  } catch (error) {
    statusEl.textContent = error.message || "保存失败。";
  }
});

imageGenerationEnabledField?.addEventListener("change", syncImageSettingsVisibility);

docButton.addEventListener("click", () => {
  if (chrome?.tabs?.create) {
    chrome.tabs.create({
      url: "https://ai.google.dev/gemini-api/docs/image-generation"
    });
    return;
  }

  window.open("https://ai.google.dev/gemini-api/docs/image-generation", "_blank", "noopener");
});

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

  syncImageSettingsVisibility();
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
  statusEl.textContent = "当前页面是本地预览。请到 chrome://extensions 打开“图透镜 Image Lens”的扩展设置页进行配置。";
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Options request failed.");
  }
  return response.data;
}
