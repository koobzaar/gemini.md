<div align="center">
  <h1>ai.md</h1>
  <p>Firefox extension for exporting ChatGPT, Claude, and Gemini conversations to structured Markdown.</p>

  <p>
    <a href="#features">Features</a> |
    <a href="#installation">Installation</a> |
    <a href="#development">Development</a> |
    <a href="#output-format">Output Format</a> |
    <a href="#limitations">Limitations</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/firefox-extension-orange" alt="Firefox extension"/>
    <a href="https://addons.mozilla.org/pt-BR/firefox/addon/ai-md/"><img src="https://img.shields.io/badge/AMO-ai.md-blue" alt="Firefox Add-ons"/></a>
    <img src="https://img.shields.io/badge/platforms-ChatGPT%20%7C%20Claude%20%7C%20Gemini-blue" alt="Platforms"/>
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License"/>
    <img src="https://img.shields.io/badge/version-1.0.0-lightgrey" alt="Version"/>
  </p>
</div>

---

**ai.md** is a Firefox WebExtension that exports ChatGPT, Claude, and Gemini conversations as structured `.md` files. The output is machine-friendly first: YAML frontmatter plus strict block delimiters so another LLM can parse turns reliably.

## Features

- Exports ChatGPT, Claude, and Gemini conversations from the current thread.
- Loads older visible conversation history before export on a best-effort basis.
- Produces structured Markdown with `::USER_MESSAGE::`, `::MODEL_REASONING::`, `::MODEL_RESPONSE::`, and `::END_TURN::` delimiters.
- Includes YAML frontmatter with title, platform, export date, source URL, turn count, and best-effort model metadata.
- Captures Gemini reasoning blocks when they are present and expandable.
- Captures Gemini and ChatGPT image attachment metadata on a best-effort basis.
- Uses Claude and Gemini native copy controls from the page context to preserve their own copied Markdown output.
- Uses direct DOM extraction for ChatGPT.
- Avoids privileged extension permissions; downloads are triggered with the browser's standard Blob link flow.
- Declares no data collection in the Firefox manifest with `data_collection_permissions.required: ["none"]`.
- Includes toolbar settings for enabling/disabling the Markdown header and choosing which metadata fields are exported.

## Installation

### Firefox Add-ons

Install from Mozilla Add-ons:

https://addons.mozilla.org/pt-BR/firefox/addon/ai-md/

### Temporary local install

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select this repository's `manifest.json`.
4. Open `https://chatgpt.com`, `https://chat.openai.com`, `https://claude.ai`, or `https://gemini.google.com`.

A floating **Export .md** control appears on supported conversation pages.

### AMO packaging

This repository is structured as a no-build WebExtension. Package the repository root as the extension source.

If you use Mozilla's `web-ext` tool:

```bash
npm run lint:amo
npm run build:dist
```

Submit the generated artifact to Mozilla Add-ons after reviewing the lint output.

### Release automation

GitHub Actions publishes new Firefox Add-ons versions from release tags.

1. Configure repository secrets `AMO_API_KEY` and `AMO_API_SECRET` with Mozilla Add-ons API credentials.
2. Update `manifest.json` to the next version.
3. Create and push a matching tag, for example `v1.0.1`.

The release workflow fails if the tag does not match `manifest.json`, runs AMO linting, builds the unsigned zip into `dist/`, uploads it as a GitHub Actions artifact, and submits the listed extension update to Mozilla Add-ons.

## Usage

Open a supported conversation. Hover over the floating tab on the right edge of the page, then click **Export .md**.

During export, the extension attempts to:

1. Scroll upward and wait for older messages to load.
2. Collect user and model messages in order from the current thread.
3. Expand Gemini reasoning blocks when available.
4. Assemble the transcript into structured Markdown.
5. Download the result as `{conversation_title}_{YYYY-MM-DD_HH-MM-SS}.md`.

The export button shows live progress and returns to **Export .md** when finished.

## Development

The extension intentionally has no bundler or runtime dependencies.

```text
manifest.json          Extension manifest.
content/content.js     Isolated content-script UI and page-script bridge.
content/content.css    Floating export control styling.
popup/                 Toolbar settings UI.
page/exporter.js       Page-context exporter logic.
icons/                 Extension icons generated from the source artwork.
```

Firefox content scripts run in an isolated JavaScript world. Claude and Gemini export depend on temporarily intercepting native page clipboard writes, so `content/content.js` injects `page/exporter.js` into the page context and communicates with it using `window.postMessage`.

## Output Format

Each export includes YAML frontmatter followed by turn-delimited transcript blocks:

```markdown
---
Title: My conversation title
Platform: Claude
Date: 2026-04-23 18:42:10 UTC
Model: Claude
Turns: 6
Source: https://claude.ai/chat/...
---

> **[SYSTEM DIRECTIVE FOR CONSUMING LLM]**
> ...

::USER_MESSAGE::
How does gradient descent work?

::MODEL_RESPONSE::
Gradient descent is an optimization algorithm...

::END_TURN::
```

When Gemini reasoning is available, a `::MODEL_REASONING::` block is inserted between `::USER_MESSAGE::` and `::MODEL_RESPONSE::`.

## How It Works

### Claude

Claude export uses Claude's own per-message copy buttons. The page-context exporter temporarily intercepts `navigator.clipboard.writeText`, clicks native copy buttons, captures the copied Markdown, and restores the clipboard method in a `finally` block.

### ChatGPT

ChatGPT export locates conversation turns using message role attributes, groups user and assistant messages, and converts message DOM to Markdown.

### Gemini

Gemini export scrolls the conversation container, expands available reasoning panels, captures prompts and responses through Gemini's native copy buttons, and extracts reasoning from the visible thoughts panel.

## Limitations

- Export quality depends on the current ChatGPT, Claude, and Gemini web UI structure.
- Claude and Gemini export depend on native copy buttons and the page clipboard API being available.
- Claude attachment metadata and artifacts are not explicitly exported.
- ChatGPT attachments and canvas-style outputs are best effort only.
- Gemini attachment handling is limited to uploaded image metadata on user prompts.
- Model metadata is best effort and may be generic when the current site UI does not expose a precise model label.

## Compatibility

| Platform | History loading | Reasoning capture | Attachment metadata | Markdown source |
|----------|:-:|:-:|:-:|----------|
| ChatGPT | Best effort | No | Best effort | Custom DOM-to-Markdown conversion |
| Claude | Best effort | No | No | Native Claude copy buttons |
| Gemini | Best effort | Yes | Images only | Native Gemini copy buttons |

## License

[MIT](./LICENSE)
