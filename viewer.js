const promptEl = document.getElementById("prompt");
const gallery = document.getElementById("gallery");
const copyPromptButton = document.getElementById("copy-prompt");
const downloadImagesButton = document.getElementById("download-images");

let currentPayload = null;

init();

async function init() {
  const stored = await chrome.storage.local.get("viewer:current");
  const payload = stored["viewer:current"];

  if (!payload) {
    promptEl.textContent = "结果不存在，可能已过期。";
    return;
  }

  currentPayload = payload;
  promptEl.textContent = payload.prompt || "未提供提示词";
  renderImages(payload.images || []);
}

copyPromptButton.addEventListener("click", async () => {
  const prompt = currentPayload?.prompt || "";
  if (!prompt) return;
  await navigator.clipboard.writeText(prompt);
  copyPromptButton.textContent = "已复制";
  setTimeout(() => {
    copyPromptButton.textContent = "复制提示词";
  }, 1200);
});

downloadImagesButton.addEventListener("click", () => {
  const images = currentPayload?.images || [];
  images.forEach((image, index) => {
    const src = `data:${image.mimeType || "image/png"};base64,${image.base64Data}`;
    triggerDownload(src, `prompt-glass-${index + 1}.png`);
  });
});

function renderImages(images) {
  if (images.length === 0) {
    gallery.innerHTML = "<p>这次没有拿到图片结果。</p>";
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

function triggerDownload(src, filename) {
  const link = document.createElement("a");
  link.href = src;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}
