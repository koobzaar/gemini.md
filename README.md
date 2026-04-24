<div align="center">
  <h1>ai.md</h1>
  <p>Export ChatGPT, Claude, and Gemini conversations to structured Markdown for downstream LLM use.</p>

  <p>
    <a href="#installation">Installation</a> •
    <a href="#usage">Usage</a> •
    <a href="#output-format">Output Format</a> •
    <a href="#how-it-works">How It Works</a> •
    <a href="#limitations">Limitations</a> •
    <a href="#compatibility">Compatibility</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/tampermonkey-compatible-blue" alt="Tampermonkey"/>
    <img src="https://img.shields.io/badge/platforms-ChatGPT%20%7C%20Claude%20%7C%20Gemini-orange" alt="Platforms"/>
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License"/>
    <img src="https://img.shields.io/badge/version-0.3.0-lightgrey" alt="Version"/>
  </p>
</div>

---

**ai.md** is a Tampermonkey userscript that exports ChatGPT, Claude, and Gemini conversations as structured `.md` files. The output is meant to be machine-friendly first: YAML frontmatter plus strict block delimiters so another LLM can parse turns reliably.

## Features

- Exports ChatGPT, Claude, and Gemini conversations after loading available history from the current thread
- Structured output with explicit block delimiters: `::USER_MESSAGE::`, `::MODEL_REASONING::`, `::MODEL_RESPONSE::`, `::END_TURN::`
- YAML frontmatter with title, platform, export date, source URL, turn count, and best-effort model metadata
- Captures Gemini reasoning blocks when they are present and expandable
- Captures metadata for user-uploaded images in Gemini prompts
- Converts Gemini message DOM to Markdown, including headings, emphasis, inline code, fenced code blocks, tables, lists, links, and KaTeX annotations
- Converts ChatGPT conversation DOM to Markdown using ChatGPT's message role attributes and turn containers
- Uses Claude's native per-message copy buttons to preserve Claude's own copied Markdown output
- Adds a floating export control on both supported sites
- Saves files as `{conversation_title}_{YYYY-MM-DD_HH-MM-SS}.md`

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or another compatible userscript manager.
2. Create a new userscript.
3. Replace the default content with the contents of [ai_md.js](./ai_md.js).
4. Save the script.
5. Open `https://gemini.google.com`, `https://claude.ai`, or `https://chatgpt.com`.

> [!NOTE]
> The script has no external dependencies and uses `@grant none`.

## Usage

Open a ChatGPT, Claude, or Gemini conversation. A floating tab appears on the right edge of the page. Hover over it to reveal the **Export .md** button, then click it.

During export, the script attempts to:

1. Scroll upward and wait for older messages to load.
2. Collect user and model messages in order from the current thread.
3. Expand reasoning blocks when available in Gemini.
4. Assemble the transcript into structured Markdown.
5. Download the result as a `.md` file.

The button shows live progress while the export is running and returns to **Export .md** when finished.

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

For Gemini prompts with uploaded images, the export may include an `**Attached images:**` section with image metadata before the user message text.

## How It Works

### Claude

Claude export does not reconstruct Markdown from the DOM. Instead, the script uses Claude's own per-message copy buttons:

1. It finds Claude's native copy buttons in each message action bar.
2. It separates user messages from assistant messages by checking whether the same action bar contains Claude's feedback button.
3. It temporarily intercepts `navigator.clipboard.writeText`.
4. It clicks the native copy buttons programmatically and captures the text Claude writes to the clipboard.
5. It restores the original clipboard method in a `finally` block.

This preserves Claude's copied Markdown format better than manual DOM parsing, but it also means Claude export depends on those page controls remaining available.

### ChatGPT

ChatGPT export uses direct DOM traversal rather than native copy buttons:

1. It locates conversation turns using ChatGPT turn containers and message role attributes.
2. It scrolls upward and waits for older visible turns to load.
3. It groups messages into user/assistant pairs using `data-message-author-role`.
4. It converts the extracted message DOM to Markdown with the same exporter used elsewhere in the script.

This first-pass adapter is focused on text fidelity and structure. It is intentionally conservative about attachments and artifacts.

### Gemini

Gemini export uses direct DOM traversal and Markdown conversion:

1. It scrolls the Gemini conversation container to load older content.
2. It expands collapsed reasoning panels when present.
3. It reads `user-query-content` and `model-response` elements from the page.
4. It converts supported HTML structures into Markdown using a recursive DOM walker.
5. It adds Gemini image metadata when prompt uploads are detected.

The DOM walker handles common inline and block elements plus Gemini-specific code blocks and KaTeX annotations.

## Limitations

- Claude export depends on native page copy buttons and `navigator.clipboard.writeText` being available in page context.
- Claude attachment metadata is not explicitly exported.
- Claude artifacts are not explicitly exported.
- Claude model metadata is currently generic: the export records `Claude` rather than the exact model variant.
- ChatGPT attachment metadata is best effort only.
- ChatGPT artifacts and canvas-style outputs are not explicitly exported.
- ChatGPT model metadata is best effort and depends on the current model switcher label being available in the page.
- Gemini attachment handling is limited to uploaded image metadata on user prompts.
- Conversation loading is best effort and depends on the current web UI structure remaining compatible.
- Gemini Markdown conversion is structured and useful, but it is not guaranteed to match site-native copy output exactly.

## Compatibility

| Platform | History loading | Reasoning capture | Attachment metadata | Markdown source |
|----------|:-:|:-:|:-:|----------|
| ChatGPT | Best effort | No | Best effort | Custom DOM-to-Markdown conversion |
| Claude | Best effort | No | No | Native Claude copy buttons |
| Gemini | Best effort | Yes | Images only | Custom DOM-to-Markdown conversion |

Validated on Chromium-based browsers and Firefox with Tampermonkey.

## License

[MIT](./LICENSE)
