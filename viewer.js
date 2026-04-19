const params = new URLSearchParams(location.search);
const jobId = params.get("jobId");
const promptEl = document.getElementById("prompt");
const gallery = document.getElementById("gallery");

init();

async function init() {
  if (!jobId) {
    promptEl.textContent = "缺少 jobId。";
    return;
  }

  const storageKey = `viewer:${jobId}`;
  const stored = await chrome.storage.local.get(storageKey);
  const payload = stored[storageKey];

  if (!payload) {
    promptEl.textContent = "结果不存在，可能已过期。";
    return;
  }

  promptEl.textContent = payload.prompt || "未提供提示词";
  renderImages(payload.images || []);
}

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
          <div class="card-footer">
            <span>结果 ${index + 1}</span>
            <a download="prompt-glass-${index + 1}.png" href="${src}">下载</a>
          </div>
        </article>
      `;
    })
    .join("");
}
