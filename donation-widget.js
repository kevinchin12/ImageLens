(function attachDonationWidget(global) {
  function createDonationWidget(target, config) {
    if (!target) return null;

    const options = {
      title: "请我喝咖啡",
      description: "",
      modalTitle: "请我喝杯咖啡",
      modalDescription: "",
      buttonLabel: "请我喝咖啡",
      closeLabel: "稍后再说",
      koFiLabel: "Ko-fi",
      koFiHint: "Global",
      koFiUrl: "",
      chinaLabel: "微信",
      chinaHint: "中国大陆",
      qrImageUrl: "",
      qrAlt: "赞赏二维码",
      scanHint: "",
      placeholderText: "",
      ...pickDefined(config)
    };

    target.innerHTML = "";

    const titleMarkup = options.title ? `<h2 class="donation-title">${escapeHtml(options.title)}</h2>` : "";

    const wrapper = document.createElement("section");
    wrapper.className = "donation-card glass";
    wrapper.innerHTML = `
      <div class="donation-content">
        <div class="section-head">
          ${titleMarkup}
          <p class="donation-copy">${escapeHtml(options.description)}</p>
        </div>
      </div>
      <button class="donation-trigger" type="button">${escapeHtml(options.buttonLabel)}</button>
    `;

    const dialog = document.createElement("dialog");
    dialog.className = "donation-modal";
    dialog.innerHTML = `
      <section class="donation-modal-card glass">
        <div class="donation-modal-head">
          <div>
            <h3 class="donation-modal-title">${escapeHtml(options.modalTitle)}</h3>
            <p class="donation-modal-copy">${escapeHtml(options.modalDescription)}</p>
          </div>
          <button class="donation-close" type="button" aria-label="关闭">×</button>
        </div>

        <div class="donation-methods">
          <button class="donation-method" data-action="kofi" type="button">
            <span class="donation-method-icon" aria-hidden="true">☕</span>
            <span class="donation-method-text">
              <strong>${escapeHtml(options.koFiLabel)}</strong>
              <small>${escapeHtml(options.koFiHint)}</small>
            </span>
          </button>

          <button class="donation-method" data-action="china" type="button" aria-expanded="false">
            <span class="donation-method-icon" aria-hidden="true">微</span>
            <span class="donation-method-text">
              <strong>${escapeHtml(options.chinaLabel)}</strong>
              <small>${escapeHtml(options.chinaHint)}</small>
            </span>
          </button>
        </div>

        <div class="donation-qr-panel donation-hidden">
          <div class="donation-qr-frame">
            ${renderQr(options)}
          </div>
          <p class="donation-scan-hint">${escapeHtml(options.scanHint)}</p>
        </div>

        <div class="donation-modal-actions">
          <button class="donation-dismiss" type="button">${escapeHtml(options.closeLabel)}</button>
        </div>
      </section>
    `;

    target.append(wrapper, dialog);

    const openButton = wrapper.querySelector(".donation-trigger");
    const closeButtons = dialog.querySelectorAll(".donation-close, .donation-dismiss");
    const koFiButton = dialog.querySelector('[data-action="kofi"]');
    const chinaButton = dialog.querySelector('[data-action="china"]');
    const qrPanel = dialog.querySelector(".donation-qr-panel");

    openButton?.addEventListener("click", () => {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
        return;
      }
      dialog.setAttribute("open", "open");
    });

    koFiButton?.addEventListener("click", () => {
      if (options.koFiUrl) {
        window.open(options.koFiUrl, "_blank", "noopener");
      }
    });

    chinaButton?.addEventListener("click", () => {
      const nextExpanded = !qrPanel.classList.contains("donation-hidden");
      qrPanel.classList.toggle("donation-hidden", nextExpanded);
      chinaButton.setAttribute("aria-expanded", String(!nextExpanded));
      chinaButton.classList.toggle("is-active", !nextExpanded);
    });

    for (const button of closeButtons) {
      button.addEventListener("click", () => dialog.close());
    }

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });

    dialog.addEventListener("close", () => {
      qrPanel.classList.add("donation-hidden");
      chinaButton?.setAttribute("aria-expanded", "false");
      chinaButton?.classList.remove("is-active");
    });

    return {
      destroy() {
        dialog.remove();
        wrapper.remove();
      }
    };
  }

  function renderQr(options) {
    if (options.qrImageUrl) {
      return `<img class="donation-qr-image" src="${escapeHtml(options.qrImageUrl)}" alt="${escapeHtml(options.qrAlt)}" />`;
    }

    return `<div class="donation-qr-placeholder">${escapeHtml(options.placeholderText).replace(/\n/g, "<br />")}</div>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function pickDefined(source) {
    const result = {};
    for (const [key, value] of Object.entries(source || {})) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  global.createDonationWidget = createDonationWidget;
})(globalThis);
