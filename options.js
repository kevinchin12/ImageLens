const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const docButton = document.getElementById("open-doc");

init();

async function init() {
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

  const formData = new FormData(form);
  const payload = {
    provider: formData.get("provider"),
    apiMode: formData.get("apiMode"),
    geminiApiKey: formData.get("geminiApiKey"),
    geminiTextModel: formData.get("geminiTextModel"),
    geminiImageModel: formData.get("geminiImageModel"),
    customProxyUrl: formData.get("customProxyUrl"),
    customProxyToken: formData.get("customProxyToken"),
    aspectRatio: formData.get("aspectRatio"),
    imageCount: Number(formData.get("imageCount")),
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

docButton.addEventListener("click", () => {
  chrome.tabs.create({
    url: "https://ai.google.dev/gemini-api/docs/image-generation"
  });
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
}

function getField(name) {
  return document.querySelector(`[name="${CSS.escape(name)}"]`);
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Options request failed.");
  }
  return response.data;
}
