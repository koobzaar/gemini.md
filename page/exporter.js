(() => {
  "use strict";

  const MESSAGE_SOURCE = "ai-md-extension";
  const APP = detectApp();
  if (!APP) return;

  let exporting = false;
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

  const CLAUDE_SELECTORS = {
    copyButton: 'button[data-testid="action-bar-copy"]',
    conversationTitle: '[data-testid="chat-title-button"] .truncate, button[data-testid="chat-title-button"] div.truncate',
    messageActionsGroup: '[role="group"][aria-label="Message actions"]',
    feedbackButton: 'button[aria-label="Give positive feedback"]',
  };

  const GEMINI_SELECTORS = {
    conversationContainer: ".conversation-container",
    conversationTitle: "conversations-list div.selected",
    userContent: "user-query-content",
    promptCopyButton: '[data-test-id="prompt-copy-button"]',
    modelResponse: "model-response",
    responseContainer: "response-container",
    responseCopyButton: 'message-actions [data-test-id="copy-button"]',
    reasoningToggle: 'button[data-test-id="thoughts-header-button"][aria-expanded="false"]',
    reasoningContent: '[data-test-id="thoughts-content"] message-content, [data-test-id="thoughts-content"]',
  };

  const CHATGPT_SELECTORS = {
    turn: 'article[data-testid^="conversation-turn-"], div[data-testid^="conversation-turn-"]',
    roleNode: "[data-message-author-role]",
    assistantContent: '.markdown, [class*="markdown"], .prose',
    modelBadge: 'button[data-testid="model-switcher-dropdown-button"], button[id*="model-switcher"]',
  };

  window.addEventListener("message", handleMessage);
  post("AI_MD_READY", { app: APP, label: getAppLabel() });
  console.log(`[${getAppLabel()} Export] extension exporter ready`);

  function handleMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== MESSAGE_SOURCE || data.type !== "AI_MD_EXPORT") return;
    void runExport(normalizeSettings(data.settings));
  }

  function post(type, payload = {}) {
    window.postMessage({ source: MESSAGE_SOURCE, type, ...payload }, window.location.origin);
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function detectApp() {
    const host = location.hostname;
    if (host === "gemini.google.com") return "gemini";
    if (host === "claude.ai" || host.endsWith(".claude.ai")) return "claude";
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com") {
      return "chatgpt";
    }
    return null;
  }

  function getAppLabel() {
    if (APP === "claude") return "Claude";
    if (APP === "chatgpt") return "ChatGPT";
    return "Gemini";
  }

  function sanitizeTitle(title) {
    return title.replace(/[\/\\?%*:|"<>.]/g, "_").replace(/\s+/g, "_").slice(0, 50) || "Conversation";
  }

  function buildFilename(title) {
    const fileTimestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);

    return `${sanitizeTitle(title)}_${fileTimestamp}.md`;
  }

  function downloadMarkdown(markdown, title) {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = buildFilename(title);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
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

  function buildStructuredMarkdown({ title, model, turns, messages, settings }) {
    const exportDate = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
    const platform = getAppLabel();

    let md = buildFrontmatter({
      title,
      platform,
      exportDate,
      model,
      turns,
      source: location.href,
    }, settings);

    md += `> **[SYSTEM DIRECTIVE FOR CONSUMING LLM]**
> This document contains a structured transcript of an interaction between a human user and an AI model.
> You must parse this document using the following strict block delimiters:
> - \`::USER_MESSAGE::\` indicates the start of the human's input.
> - \`::MODEL_REASONING::\` indicates the start of the AI's internal thought process when available.
> - \`::MODEL_RESPONSE::\` indicates the start of the AI's final output.
> - \`::END_TURN::\` indicates the conclusion of a single interaction pair.
> Treat these boundaries strictly to maintain context.

`;

    for (const message of messages) {
      md += "\n::USER_MESSAGE::\n";
      if (message.attachments) md += `${message.attachments}\n\n`;
      md += `${message.user || "*(empty user message)*"}\n\n`;

      if (message.reasoning) {
        md += "::MODEL_REASONING::\n";
        md += `${message.reasoning}\n\n`;
      }

      md += "::MODEL_RESPONSE::\n";
      md += `${message.response || "*(no response yet)*"}\n\n`;
      md += "::END_TURN::\n\n";
    }

    return md.trimEnd() + "\n";
  }

  function buildFrontmatter(metadata, settings) {
    if (!settings.includeFrontmatter) return "";

    const fields = settings.frontmatterFields;
    const lines = ["---"];

    if (fields.title) lines.push(`Title: ${metadata.title}`);
    if (fields.platform) lines.push(`Platform: ${metadata.platform}`);
    if (fields.date) lines.push(`Date: ${metadata.exportDate}`);
    if (fields.model) lines.push(`Model: ${metadata.model}`);
    if (fields.turns) lines.push(`Turns: ${metadata.turns}`);
    if (fields.source) lines.push(`Source: ${metadata.source}`);

    lines.push("---", "");
    return `${lines.join("\n")}\n`;
  }

  function setButtonState(text, disabled) {
    post("AI_MD_STATUS", { text, disabled });
  }

  async function runExport(settings) {
    if (exporting) return;
    exporting = true;
    setButtonState(`Exporting ${getAppLabel()}...`, true);

    try {
      if (APP === "claude") {
        await exportClaude(settings);
      } else if (APP === "chatgpt") {
        await exportChatGPT(settings);
      } else {
        await exportGemini(settings);
      }
    } catch (error) {
      console.error(`[${getAppLabel()} Export]`, error);
      post("AI_MD_ERROR", { message: `${getAppLabel()} export failed: ${error.message}` });
    } finally {
      exporting = false;
      setButtonState("Export .md", false);
    }
  }

  function nodeToMd(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();

    if (["script", "style", "button", "mat-icon", "svg"].includes(tag)) return "";
    if (node.classList?.contains("katex-html")) return "";
    if (tag === "mrow") return "";

    if (tag === "annotation" && node.getAttribute("encoding") === "application/x-tex") {
      const latex = node.textContent.trim();
      return node.closest(".katex-display") ? `\n$$\n${latex}\n$$\n` : `$${latex}$`;
    }

    if (tag === "code-block") {
      const lang = node.querySelector("div > div > span")?.textContent?.trim() || "";
      const pre = node.querySelector("div > div:nth-child(2) > div > pre");
      return `\n\`\`\`${lang}\n${pre ? pre.textContent : node.textContent}\n\`\`\`\n`;
    }

    if (tag === "pre") {
      const code = node.querySelector("code");
      const text = (code ? code.textContent : node.textContent || "").replace(/\n$/, "");
      const className = code?.className || "";
      let lang = className.match(/language-([\w-]+)/)?.[1] || "";

      if (!lang) {
        const header = node.parentElement?.querySelector("div");
        const headerLabel = header?.querySelector("span")?.textContent?.trim();
        if (headerLabel && headerLabel.length <= 20) lang = headerLabel;
      }

      return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    }

    const inner = () => Array.from(node.childNodes).map(nodeToMd).join("");

    if (tag === "strong" || tag === "b") return `**${node.textContent}**`;
    if (tag === "em" || tag === "i") return `*${node.textContent}*`;
    if (tag === "code" && node.closest("p,li")) return `\`${node.textContent}\``;
    if (tag === "a") return `[${node.textContent}](${node.href})`;
    if (tag === "img") return `[Image: ${node.alt || node.src}]`;
    if (tag === "hr") return "\n---\n";
    if (tag === "br") return "\n";
    if (tag === "blockquote") return `\n> ${inner().trim().replace(/\n/g, "\n> ")}\n`;
    if (tag === "p") return `\n${inner()}\n`;

    for (let i = 1; i <= 6; i++) {
      if (tag === `h${i}`) return `\n${"#".repeat(i)} ${node.textContent.trim()}\n`;
    }

    if (tag === "ul") {
      return "\n" + Array.from(node.querySelectorAll(":scope > li"))
        .map((li) => `- ${li.textContent.trim()}`)
        .join("\n") + "\n";
    }

    if (tag === "ol") {
      return "\n" + Array.from(node.querySelectorAll(":scope > li"))
        .map((li, i) => `${i + 1}. ${li.textContent.trim()}`)
        .join("\n") + "\n";
    }

    if (tag === "table") {
      let md = "\n";

      node.querySelectorAll("thead tr").forEach((tr) => {
        tr.querySelectorAll("th").forEach((th) => { md += `| ${th.textContent.trim()} `; });
        md += "|\n";
        tr.querySelectorAll("th").forEach(() => { md += "| --- "; });
        md += "|\n";
      });

      node.querySelectorAll("tbody tr").forEach((tr) => {
        tr.querySelectorAll("td").forEach((td) => { md += `| ${td.textContent.trim()} `; });
        md += "|\n";
      });

      return md;
    }

    return inner();
  }

  function toMd(el) {
    return nodeToMd(el).replace(/\n{3,}/g, "\n\n").trim();
  }

  function extractGeminiImages(queryEl) {
    const imgs = queryEl.querySelectorAll('img[data-test-id="uploaded-img"]');
    if (!imgs.length) return null;

    return [
      "**Attached images:**",
      ...Array.from(imgs).map((img, i) =>
        `- Attached image ${i + 1}: ${img.alt || "(no alt text)"} - ${img.src.slice(0, 80)}...`
      ),
    ].join("\n");
  }

  function getGeminiModelName(responseEl) {
    const botName = responseEl.querySelector(".bot-name-text")?.textContent?.trim();
    const gemBadge = responseEl.querySelector(".bot-name-ugc-label")?.textContent?.trim();
    if (botName && gemBadge) return `${botName} (${gemBadge})`;
    if (botName) return botName;
    return "Gemini";
  }

  function findGeminiScroller() {
    const candidates = [
      document.querySelector("#chat-history"),
      document.querySelector(".chat-history-scroll-container"),
      document.querySelector("infinite-scroller"),
      document.querySelector("chat-window-content"),
    ];

    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight + 50) return el;
    }

    return document.documentElement;
  }

  function triggerScrollEvent(el) {
    el.dispatchEvent(new Event("scroll", { bubbles: true, cancelable: false }));
    el.dispatchEvent(new Event("wheel", { bubbles: true, cancelable: false }));
  }

  async function loadGeminiConversation() {
    const pollMs = 600;
    const stableNeeded = 4;
    const safetyMs = 10 * 60 * 1000;
    const startTime = Date.now();

    let lastCount = -1;
    let lastHeight = -1;
    let stableCount = 0;

    while (true) {
      const scroller = findGeminiScroller();
      const convs = document.querySelectorAll(GEMINI_SELECTORS.conversationContainer);
      const first = convs[0];

      if (first) first.scrollIntoView({ behavior: "instant", block: "start" });
      scroller.scrollTop = 0;

      requestAnimationFrame(() => {
        triggerScrollEvent(scroller);
        if (scroller !== document.documentElement) triggerScrollEvent(document);
      });

      await wait(pollMs);

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const currentCount = document.querySelectorAll(GEMINI_SELECTORS.conversationContainer).length;
      const currentHeight = findGeminiScroller().scrollHeight;
      setButtonState(`Loading... ${elapsed}s (${currentCount} msgs)`, true);

      if (Date.now() - startTime >= safetyMs) {
        console.warn("[Gemini Export] Safety timeout (10 min).");
        return;
      }

      if (currentCount !== lastCount || currentHeight !== lastHeight) {
        lastCount = currentCount;
        lastHeight = currentHeight;
        stableCount = 0;
      } else {
        stableCount += 1;
        if (stableCount >= stableNeeded) return;
      }
    }
  }

  async function expandGeminiReasoning() {
    const btns = document.querySelectorAll(GEMINI_SELECTORS.reasoningToggle);

    if (!btns.length) return;
    setButtonState(`Expanding reasoning (${btns.length})...`, true);
    btns.forEach((btn) => btn.click());
    await wait(600);
  }

  function getGeminiTitle() {
    return document.querySelector(GEMINI_SELECTORS.conversationTitle)?.textContent?.trim()
      || document.title?.replace(" - Gemini", "").trim()
      || "Gemini Conversation";
  }

  function getGeminiTurns() {
    return Array.from(document.querySelectorAll(GEMINI_SELECTORS.conversationContainer));
  }

  function extractGeminiReasoning(turnEl) {
    const reasoningNode = turnEl.querySelector(GEMINI_SELECTORS.reasoningContent);
    if (!reasoningNode) return null;

    const reasoning = toMd(reasoningNode);
    return reasoning || null;
  }

  async function captureGeminiConversation() {
    const turns = getGeminiTurns();
    const originalWriteText = navigator.clipboard?.writeText;
    const originalWrite = navigator.clipboard?.write;

    if (!navigator.clipboard || typeof originalWriteText !== "function") {
      throw new Error("Clipboard API is unavailable in this browser context.");
    }

    const messages = [];
    let currentCapture = null;

    try {
      navigator.clipboard.writeText = async (text) => {
        if (currentCapture && typeof text === "string" && text.trim()) {
          currentCapture.push(text.trim());
        }
        return undefined;
      };

      if (typeof originalWrite === "function") {
        navigator.clipboard.write = async (items) => {
          if (currentCapture && Array.isArray(items)) {
            for (const item of items) {
              if (!item?.types?.includes("text/plain")) continue;
              const blob = await item.getType("text/plain");
              const text = await blob.text();
              if (text.trim()) currentCapture.push(text.trim());
              break;
            }
          }
          return undefined;
        };
      }
    } catch (error) {
      throw new Error(`Could not intercept Gemini copy actions: ${error.message}`);
    }

    try {
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const userContent = turn.querySelector(GEMINI_SELECTORS.userContent);
        const response = turn.querySelector(GEMINI_SELECTORS.modelResponse);
        const promptCopyButton = turn.querySelector(GEMINI_SELECTORS.promptCopyButton);
        const responseCopyButton = turn.querySelector(GEMINI_SELECTORS.responseCopyButton);

        if (!userContent && !response) continue;

        let copiedUser = null;
        let copiedResponse = null;

        if (promptCopyButton) {
          const promptCaptures = [];
          currentCapture = promptCaptures;
          promptCopyButton.scrollIntoView({ behavior: "instant", block: "center" });
          setButtonState(`Copying Gemini prompts ${i + 1}/${turns.length}`, true);
          promptCopyButton.click();

          if (await waitForCapture(promptCaptures, 0)) {
            copiedUser = promptCaptures.at(-1) || null;
          } else {
            console.warn(`[Gemini Export] Missed clipboard capture for prompt ${i + 1}.`);
          }
        }

        if (responseCopyButton) {
          const responseCaptures = [];
          currentCapture = responseCaptures;
          responseCopyButton.scrollIntoView({ behavior: "instant", block: "center" });
          setButtonState(`Copying Gemini responses ${i + 1}/${turns.length}`, true);
          responseCopyButton.click();

          if (await waitForCapture(responseCaptures, 0)) {
            copiedResponse = responseCaptures.at(-1) || null;
          } else {
            console.warn(`[Gemini Export] Missed clipboard capture for response ${i + 1}.`);
          }
        }

        currentCapture = null;

        const fallbackResponseNode = response?.querySelector("message-content") || response;
        const user = copiedUser || (userContent ? toMd(userContent) : null);
        const model = copiedResponse || (fallbackResponseNode ? toMd(fallbackResponseNode) : null);

        if (!user && !model) continue;

        messages.push({
          user,
          attachments: userContent ? extractGeminiImages(userContent) : null,
          reasoning: extractGeminiReasoning(turn),
          response: model,
        });

        await wait(80);
      }
    } finally {
      currentCapture = null;
      try {
        navigator.clipboard.writeText = originalWriteText;
      } catch (error) {
        console.warn("[Gemini Export] Failed to restore clipboard.writeText", error);
      }
      if (typeof originalWrite === "function") {
        try {
          navigator.clipboard.write = originalWrite;
        } catch (error) {
          console.warn("[Gemini Export] Failed to restore clipboard.write", error);
        }
      }
    }

    return messages;
  }

  async function exportGemini(settings) {
    setButtonState("Loading Gemini thread...", true);
    await loadGeminiConversation();
    await expandGeminiReasoning();
    const rawTitle = getGeminiTitle();
    const turns = getGeminiTurns();
    const firstReply = turns
      .map((turn) => turn.querySelector(GEMINI_SELECTORS.responseContainer) || turn.querySelector(GEMINI_SELECTORS.modelResponse))
      .find(Boolean);
    const modelName = firstReply ? getGeminiModelName(firstReply) : "Gemini";
    const messages = await captureGeminiConversation();

    if (!messages.length) throw new Error("No Gemini conversation found.");

    const markdown = buildStructuredMarkdown({
      title: rawTitle,
      model: modelName,
      turns: messages.length,
      messages,
      settings,
    });

    downloadMarkdown(markdown, rawTitle);
  }

  function getClaudeTitle() {
    return document.querySelector(CLAUDE_SELECTORS.conversationTitle)?.textContent?.trim()
      || document.title?.replace(/\s*\|\s*Claude$/, "").trim()
      || document.title?.replace(/\s*-\s*Claude$/, "").trim()
      || "Claude Conversation";
  }

  function findClaudeScroller() {
    const candidates = [
      document.querySelector("[data-radix-scroll-area-viewport]"),
      document.querySelector("main"),
      document.scrollingElement,
      document.documentElement,
    ];

    for (const el of candidates) {
      if (!el) continue;
      if (el.scrollHeight > el.clientHeight + 50) return el;
    }

    return document.documentElement;
  }

  function getClaudeCopyButtons(claudeOnly) {
    const groups = Array.from(document.querySelectorAll(CLAUDE_SELECTORS.messageActionsGroup));

    return groups.flatMap((group) => {
      const hasFeedback = Boolean(group.querySelector(CLAUDE_SELECTORS.feedbackButton));
      if (hasFeedback !== claudeOnly) return [];

      const copyBtn = group.querySelector(CLAUDE_SELECTORS.copyButton);
      return copyBtn ? [copyBtn] : [];
    });
  }

  async function loadClaudeConversation() {
    const pollMs = 500;
    const stableNeeded = 4;
    const safetyMs = 4 * 60 * 1000;
    const startTime = Date.now();

    let lastCount = -1;
    let lastHeight = -1;
    let stableCount = 0;

    while (true) {
      const scroller = findClaudeScroller();
      scroller.scrollTop = 0;
      triggerScrollEvent(scroller);
      if (scroller !== document.documentElement) triggerScrollEvent(document);

      await wait(pollMs);

      const totalButtons = document.querySelectorAll(CLAUDE_SELECTORS.copyButton).length;
      const currentHeight = findClaudeScroller().scrollHeight;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      setButtonState(`Loading... ${elapsed}s (${totalButtons} msgs)`, true);

      if (Date.now() - startTime >= safetyMs) {
        console.warn("[Claude Export] Safety timeout reached while loading history.");
        return;
      }

      if (totalButtons !== lastCount || currentHeight !== lastHeight) {
        lastCount = totalButtons;
        lastHeight = currentHeight;
        stableCount = 0;
      } else {
        stableCount += 1;
        if (stableCount >= stableNeeded) return;
      }
    }
  }

  async function waitForCapture(list, previousLength) {
    const timeoutMs = 1200;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      if (list.length > previousLength) return true;
      await wait(25);
    }

    return false;
  }

  async function captureClaudeMessages(buttons, destination, label) {
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      btn.scrollIntoView({ behavior: "instant", block: "center" });
      setButtonState(`${label} ${i + 1}/${buttons.length}`, true);
      const before = destination.length;
      btn.click();
      const captured = await waitForCapture(destination, before);

      if (!captured) {
        console.warn(`[Claude Export] Missed clipboard capture for ${label.toLowerCase()} ${i + 1}.`);
      }

      await wait(80);
    }
  }

  async function captureClaudeConversation() {
    const humanMessages = [];
    const modelMessages = [];
    const originalWriteText = navigator.clipboard?.writeText;

    if (!navigator.clipboard || typeof originalWriteText !== "function") {
      throw new Error("Clipboard API is unavailable in this browser context.");
    }

    let currentTarget = humanMessages;

    try {
      navigator.clipboard.writeText = async (text) => {
        if (typeof text === "string" && text.trim()) {
          currentTarget.push(text.trim());
        }
        return undefined;
      };
    } catch (error) {
      throw new Error(`Could not intercept Claude copy actions: ${error.message}`);
    }

    try {
      const humanButtons = getClaudeCopyButtons(false);
      const claudeButtons = getClaudeCopyButtons(true);

      if (!humanButtons.length && !claudeButtons.length) {
        throw new Error("No Claude messages were found in the current thread.");
      }

      currentTarget = humanMessages;
      await captureClaudeMessages(humanButtons, humanMessages, "Copying user messages");

      currentTarget = modelMessages;
      await captureClaudeMessages(claudeButtons, modelMessages, "Copying Claude responses");

      return { humanMessages, modelMessages };
    } finally {
      try {
        navigator.clipboard.writeText = originalWriteText;
      } catch (error) {
        console.warn("[Claude Export] Failed to restore clipboard.writeText", error);
      }
    }
  }

  async function exportClaude(settings) {
    setButtonState("Loading Claude thread...", true);
    await loadClaudeConversation();

    const title = getClaudeTitle();
    const { humanMessages, modelMessages } = await captureClaudeConversation();
    const pairCount = Math.min(humanMessages.length, modelMessages.length);

    if (pairCount === 0 && !humanMessages.length) {
      throw new Error("No Claude messages could be captured.");
    }

    const messages = [];

    for (let i = 0; i < pairCount; i++) {
      messages.push({
        user: humanMessages[i],
        reasoning: null,
        response: modelMessages[i],
      });
    }

    if (humanMessages.length > modelMessages.length) {
      messages.push({
        user: humanMessages.at(-1),
        reasoning: null,
        response: null,
      });
    }

    const markdown = buildStructuredMarkdown({
      title,
      model: "Claude",
      turns: messages.length,
      messages,
      settings,
    });

    downloadMarkdown(markdown, title);
  }

  function getChatGPTTitle() {
    const cleanedTitle = document.title
      ?.replace(/\s*\|\s*ChatGPT$/, "")
      ?.replace(/\s*-\s*ChatGPT$/, "")
      ?.trim();

    if (cleanedTitle && cleanedTitle !== "ChatGPT") return cleanedTitle;

    const firstUser = document.querySelector(`${CHATGPT_SELECTORS.roleNode}[data-message-author-role="user"]`);
    const preview = firstUser?.textContent?.trim()?.replace(/\s+/g, " ");
    if (preview) return preview.slice(0, 80);

    return "ChatGPT Conversation";
  }

  function getChatGPTModelName() {
    const badge = document.querySelector(CHATGPT_SELECTORS.modelBadge)?.textContent?.trim();
    return badge || "ChatGPT";
  }

  function getChatGPTTurnNodes() {
    const turns = Array.from(document.querySelectorAll(CHATGPT_SELECTORS.turn));
    if (turns.length) return turns;

    const roleNodes = Array.from(document.querySelectorAll(CHATGPT_SELECTORS.roleNode));
    return roleNodes
      .map((node) => node.closest("article") || node.closest('div[data-testid^="conversation-turn-"]') || node)
      .filter((node, index, arr) => arr.indexOf(node) === index);
  }

  function findScrollableAncestor(node) {
    let current = node?.parentElement;

    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      const canScroll = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";

      if (canScroll && current.scrollHeight > current.clientHeight + 50) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function findChatGPTScroller() {
    const firstTurn = getChatGPTTurnNodes()[0];
    const candidates = [
      findScrollableAncestor(firstTurn),
      firstTurn?.parentElement,
      firstTurn?.closest("main")?.querySelector("section")?.parentElement,
      document.querySelector("main"),
      document.body,
      document.scrollingElement,
      document.documentElement,
    ];

    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight + 50) return el;
    }

    return document.documentElement;
  }

  async function loadChatGPTConversation() {
    const pollMs = 500;
    const stableNeeded = 4;
    const safetyMs = 4 * 60 * 1000;
    const startTime = Date.now();

    let lastCount = -1;
    let lastHeight = -1;
    let stableCount = 0;

    while (true) {
      const turns = getChatGPTTurnNodes();
      const firstTurn = turns[0];
      const scroller = findChatGPTScroller();

      if (firstTurn) {
        firstTurn.scrollIntoView({ behavior: "instant", block: "start" });
      }

      if (scroller === document.documentElement || scroller === document.body || scroller === document.scrollingElement) {
        window.scrollTo(0, 0);
      } else {
        scroller.scrollTop = 0;
      }

      requestAnimationFrame(() => {
        triggerScrollEvent(scroller);
        if (scroller !== document.documentElement) triggerScrollEvent(document);
      });

      await wait(pollMs);

      const currentCount = getChatGPTTurnNodes().length;
      const currentHeight = findChatGPTScroller().scrollHeight;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      setButtonState(`Loading... ${elapsed}s (${currentCount} msgs)`, true);

      if (Date.now() - startTime >= safetyMs) {
        console.warn("[ChatGPT Export] Safety timeout reached while loading history.");
        return;
      }

      if (currentCount !== lastCount || currentHeight !== lastHeight) {
        lastCount = currentCount;
        lastHeight = currentHeight;
        stableCount = 0;
      } else {
        stableCount += 1;
        if (stableCount >= stableNeeded) return;
      }
    }
  }

  function cloneChatGPTRoleNode(roleNode) {
    const clone = roleNode.cloneNode(true);
    clone.querySelectorAll("button, nav, form, textarea, input, svg, script, style").forEach((el) => el.remove());
    return clone;
  }

  function extractChatGPTAttachments(roleNode) {
    const images = roleNode.querySelectorAll("img");
    if (!images.length) return null;

    return [
      "**Attached images:**",
      ...Array.from(images).map((img, i) =>
        `- Attached image ${i + 1}: ${img.alt || "(no alt text)"} - ${img.src.slice(0, 80)}...`
      ),
    ].join("\n");
  }

  function extractChatGPTMessages() {
    const turns = getChatGPTTurnNodes();
    const messages = [];
    let pendingUser = null;

    for (const turn of turns) {
      const roleNode = turn.matches(CHATGPT_SELECTORS.roleNode)
        ? turn
        : turn.querySelector(CHATGPT_SELECTORS.roleNode);
      const role = roleNode?.getAttribute("data-message-author-role");
      if (!roleNode || !role) continue;

      const contentNode = role === "assistant"
        ? roleNode.querySelector(CHATGPT_SELECTORS.assistantContent) || roleNode
        : roleNode;
      const cleaned = cloneChatGPTRoleNode(contentNode);
      const content = toMd(cleaned);

      if (!content) continue;

      if (role === "user") {
        if (pendingUser) messages.push(pendingUser);
        pendingUser = {
          user: content,
          attachments: extractChatGPTAttachments(roleNode),
          reasoning: null,
          response: null,
        };
        continue;
      }

      if (role === "assistant") {
        if (pendingUser) {
          pendingUser.response = content;
          messages.push(pendingUser);
          pendingUser = null;
        } else {
          messages.push({
            user: "*(missing user message)*",
            reasoning: null,
            response: content,
          });
        }
      }
    }

    if (pendingUser) messages.push(pendingUser);
    return messages;
  }

  async function exportChatGPT(settings) {
    setButtonState("Loading ChatGPT thread...", true);
    await loadChatGPTConversation();

    const title = getChatGPTTitle();
    const messages = extractChatGPTMessages();

    if (!messages.length) {
      throw new Error("No ChatGPT messages were found in the current thread.");
    }

    const markdown = buildStructuredMarkdown({
      title,
      model: getChatGPTModelName(),
      turns: messages.length,
      messages,
      settings,
    });

    downloadMarkdown(markdown, title);
  }
})();
