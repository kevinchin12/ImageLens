const promptEl = document.getElementById("prompt");
const gallery = document.getElementById("gallery");
const copyPromptButton = document.getElementById("copy-prompt");
const downloadImagesButton = document.getElementById("download-images");

let currentPayload = null;
let currentSettings = null;
const VIEWER_DB_NAME = "image-lens-db";
const VIEWER_STORE_NAME = "viewer_payloads";
const VIEWER_RECORD_ID = "current";

init();

async function init() {
  currentSettings = await readSettings();
  applyStaticTranslations();

  const payload = await readViewerPayload();

  if (!payload) {
    promptEl.textContent = t("viewerMissingPayload");
    return;
  }

  currentPayload = payload;
  promptEl.textContent = payload.prompt || t("viewerPromptMissing");
  renderImages(payload.images || []);
}

copyPromptButton.addEventListener("click", async () => {
  const prompt = currentPayload?.prompt || "";
  if (!prompt) return;
  await navigator.clipboard.writeText(prompt);
  copyPromptButton.textContent = t("viewerCopied");
  setTimeout(() => {
    copyPromptButton.textContent = t("viewerCopyPrompt");
  }, 1200);
});

downloadImagesButton.addEventListener("click", () => {
  const images = currentPayload?.images || [];
  images.forEach((image, index) => {
    const src = `data:${image.mimeType || "image/png"};base64,${image.base64Data}`;
    triggerDownload(src, `image-lens-${index + 1}.png`);
  });
});

function applyStaticTranslations() {
  document.documentElement.lang = getTranslator().messages.htmlLang;
  document.title = t("viewerTitle");
  document.getElementById("viewer-eyebrow").textContent = t("appName");
  document.getElementById("viewer-heading").textContent = t("viewerHeading");
  copyPromptButton.textContent = t("viewerCopyPrompt");
  downloadImagesButton.textContent = t("viewerDownloadImages");
  if (!currentPayload) {
    promptEl.textContent = t("viewerLoading");
  }
}

function renderImages(images) {
  if (images.length === 0) {
    gallery.innerHTML = `<p>${escapeHtml(t("viewerNoImages"))}</p>`;
    return;
  }

  gallery.innerHTML = images
    .map((image, index) => {
      const src = `data:${image.mimeType || "image/png"};base64,${image.base64Data}`;
      return `
        <article class="glass card">
          <img src="${src}" alt="generated ${index + 1}" />
        </article>
      `;
    })
    .join("");
}

function getTranslator() {
  return globalThis.ImageLensI18n.createTranslator(currentSettings?.uiLanguage || "auto");
}

function t(key, values) {
  return getTranslator().t(key, values);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function triggerDownload(src, filename) {
  const link = document.createElement("a");
  link.href = src;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

async function readSettings() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["uiLanguage"], (result) => {
        resolve(result || {});
      });
    } catch {
      resolve({});
    }
  });
}

async function readViewerPayload() {
  const db = await openViewerDb();
  const payload = await new Promise((resolve, reject) => {
    const tx = db.transaction(VIEWER_STORE_NAME, "readonly");
    const store = tx.objectStore(VIEWER_STORE_NAME);
    const request = store.get(VIEWER_RECORD_ID);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Failed to read viewer payload."));
  });
  db.close();
  return payload;
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
