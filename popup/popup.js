(() => {
  "use strict";

  const SETTINGS_KEY = "aiMdExportSettings";
  const DEFAULT_SETTINGS = {
    includeFrontmatter: true,
    frontmatterFields: {
      title: true,
      platform: true,
      date: true,
      model: true,
      turns: true,
      source: true,
    },
  };

  const includeFrontmatter = document.getElementById("include-frontmatter");
  const fieldGroup = document.querySelector(".field-group");
  const fieldInputs = Array.from(document.querySelectorAll("[data-field]"));
  const status = document.getElementById("status");

  void init();

  async function init() {
    const settings = await loadSettings();
    render(settings);

    includeFrontmatter.addEventListener("change", saveFromUi);
    fieldInputs.forEach((input) => input.addEventListener("change", saveFromUi));
  }

  async function loadSettings() {
    const stored = await browser.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(stored[SETTINGS_KEY]);
  }

  function render(settings) {
    includeFrontmatter.checked = settings.includeFrontmatter;
    fieldInputs.forEach((input) => {
      input.checked = Boolean(settings.frontmatterFields[input.dataset.field]);
      input.disabled = !settings.includeFrontmatter;
    });
    fieldGroup.setAttribute("aria-disabled", String(!settings.includeFrontmatter));
  }

  async function saveFromUi() {
    const settings = {
      includeFrontmatter: includeFrontmatter.checked,
      frontmatterFields: Object.fromEntries(
        fieldInputs.map((input) => [input.dataset.field, input.checked])
      ),
    };

    render(settings);
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
    showSaved();
  }

  function normalizeSettings(settings) {
    return {
      includeFrontmatter: settings?.includeFrontmatter ?? DEFAULT_SETTINGS.includeFrontmatter,
      frontmatterFields: {
        ...DEFAULT_SETTINGS.frontmatterFields,
        ...(settings?.frontmatterFields || {}),
      },
    };
  }

  function showSaved() {
    status.textContent = "Saved";
    window.setTimeout(() => {
      status.textContent = "";
    }, 900);
  }
})();
