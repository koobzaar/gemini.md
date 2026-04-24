// ==UserScript==
// @name         ai.md Transcript Exporter (LLM Optimized)
// @description  Exports Gemini, Claude, and ChatGPT conversations to structured Markdown optimized for downstream LLM ingestion.
// @version      0.3.0
// @author       you
// @namespace    ai-md-export
// @include      *://gemini.google.com/*
// @include      *://claude.ai/*
// @include      *://chatgpt.com/*
// @include      *://chat.openai.com/*
// @noframes
// @license      MIT
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const APP = detectApp();
  if (!APP) return;

  const UI_IDS = {
    container: 'llm-export-md-container',
    button: 'llm-export-md-btn',
  };

  const CLAUDE_SELECTORS = {
    copyButton: 'button[data-testid="action-bar-copy"]',
    conversationTitle: '[data-testid="chat-title-button"] .truncate, button[data-testid="chat-title-button"] div.truncate',
    messageActionsGroup: '[role="group"][aria-label="Message actions"]',
    feedbackButton: 'button[aria-label="Give positive feedback"]',
  };

  const CHATGPT_SELECTORS = {
    turn: 'article[data-testid^="conversation-turn-"], div[data-testid^="conversation-turn-"]',
    roleNode: '[data-message-author-role]',
    assistantContent: '.markdown, [class*="markdown"], .prose',
    modelBadge: 'button[data-testid="model-switcher-dropdown-button"], button[id*="model-switcher"]',
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function detectApp() {
    const host = location.hostname;
    if (host === 'gemini.google.com') return 'gemini';
    if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
    if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'chat.openai.com') {
      return 'chatgpt';
    }
    return null;
  }

  function getAppLabel() {
    if (APP === 'claude') return 'Claude';
    if (APP === 'chatgpt') return 'ChatGPT';
    return 'Gemini';
  }

  function sanitizeTitle(title) {
    return title.replace(/[\/\\?%*:|"<>.]/g, '_').replace(/\s+/g, '_').slice(0, 50) || 'Conversation';
  }

  function buildFilename(title) {
    const fileTimestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, 19);

    return `${sanitizeTitle(title)}_${fileTimestamp}.md`;
  }

  function downloadMarkdown(markdown, title) {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = buildFilename(title);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function buildStructuredMarkdown({ title, model, turns, messages }) {
    const exportDate = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
    const platform = getAppLabel();

    let md = `---
Title: ${title}
Platform: ${platform}
Date: ${exportDate}
Model: ${model}
Turns: ${turns}
Source: ${location.href}
---

> **[SYSTEM DIRECTIVE FOR CONSUMING LLM]**
> This document contains a structured transcript of an interaction between a human user and an AI model.
> You must parse this document using the following strict block delimiters:
> - \`::USER_MESSAGE::\` indicates the start of the human's input.
> - \`::MODEL_REASONING::\` indicates the start of the AI's internal thought process when available.
> - \`::MODEL_RESPONSE::\` indicates the start of the AI's final output.
> - \`::END_TURN::\` indicates the conclusion of a single interaction pair.
> Treat these boundaries strictly to maintain context.

`;

    for (const message of messages) {
      md += `\n::USER_MESSAGE::\n`;
      if (message.attachments) md += `${message.attachments}\n\n`;
      md += `${message.user || '*(empty user message)*'}\n\n`;

      if (message.reasoning) {
        md += `::MODEL_REASONING::\n`;
        md += `${message.reasoning}\n\n`;
      }

      md += `::MODEL_RESPONSE::\n`;
      md += `${message.response || '*(no response yet)*'}\n\n`;
      md += `::END_TURN::\n\n`;
    }

    return md.trimEnd() + '\n';
  }

  function setButtonState(text, disabled) {
    const btn = document.getElementById(UI_IDS.button);
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = disabled;
    btn.style.opacity = disabled ? '0.6' : '1';
    btn.style.cursor = disabled ? 'default' : 'pointer';
  }

  async function runExport() {
    setButtonState(`Exporting ${getAppLabel()}...`, true);

    try {
      if (APP === 'claude') {
        await exportClaude();
      } else if (APP === 'chatgpt') {
        await exportChatGPT();
      } else {
        await exportGemini();
      }
      setButtonState('Export .md', false);
    } catch (error) {
      console.error(`[${getAppLabel()} Export]`, error);
      alert(`${getAppLabel()} export failed: ${error.message}`);
      setButtonState('Export .md', false);
    }
  }

  // ─── Gemini conversion ──────────────────────────────────────────────────────
  function nodeToMd(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();

    if (['script', 'style', 'button', 'mat-icon', 'svg'].includes(tag)) return '';
    if (node.classList?.contains('katex-html')) return '';
    if (tag === 'mrow') return '';

    if (tag === 'annotation' && node.getAttribute('encoding') === 'application/x-tex') {
      const latex = node.textContent.trim();
      return node.closest('.katex-display') ? `\n$$\n${latex}\n$$\n` : `$${latex}$`;
    }

    if (tag === 'code-block') {
      const lang = node.querySelector('div > div > span')?.textContent?.trim() || '';
      const pre = node.querySelector('div > div:nth-child(2) > div > pre');
      return `\n\`\`\`${lang}\n${pre ? pre.textContent : node.textContent}\n\`\`\`\n`;
    }

    if (tag === 'pre') {
      const code = node.querySelector('code');
      const text = (code ? code.textContent : node.textContent || '').replace(/\n$/, '');
      const className = code?.className || '';
      let lang = className.match(/language-([\w-]+)/)?.[1] || '';

      if (!lang) {
        const header = node.parentElement?.querySelector('div');
        const headerLabel = header?.querySelector('span')?.textContent?.trim();
        if (headerLabel && headerLabel.length <= 20) lang = headerLabel;
      }

      return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
    }

    const inner = () => Array.from(node.childNodes).map(nodeToMd).join('');

    if (tag === 'strong' || tag === 'b') return `**${node.textContent}**`;
    if (tag === 'em' || tag === 'i') return `*${node.textContent}*`;
    if (tag === 'code' && node.closest('p,li')) return `\`${node.textContent}\``;
    if (tag === 'a') return `[${node.textContent}](${node.href})`;
    if (tag === 'img') return `[Image: ${node.alt || node.src}]`;
    if (tag === 'hr') return '\n---\n';
    if (tag === 'br') return '\n';
    if (tag === 'blockquote') return `\n> ${inner().trim().replace(/\n/g, '\n> ')}\n`;
    if (tag === 'p') return `\n${inner()}\n`;

    for (let i = 1; i <= 6; i++) {
      if (tag === `h${i}`) return `\n${'#'.repeat(i)} ${node.textContent.trim()}\n`;
    }

    if (tag === 'ul') {
      return '\n' + Array.from(node.querySelectorAll(':scope > li'))
        .map((li) => `- ${li.textContent.trim()}`)
        .join('\n') + '\n';
    }

    if (tag === 'ol') {
      return '\n' + Array.from(node.querySelectorAll(':scope > li'))
        .map((li, i) => `${i + 1}. ${li.textContent.trim()}`)
        .join('\n') + '\n';
    }

    if (tag === 'table') {
      let md = '\n';

      node.querySelectorAll('thead tr').forEach((tr) => {
        tr.querySelectorAll('th').forEach((th) => { md += `| ${th.textContent.trim()} `; });
        md += '|\n';
        tr.querySelectorAll('th').forEach(() => { md += '| --- '; });
        md += '|\n';
      });

      node.querySelectorAll('tbody tr').forEach((tr) => {
        tr.querySelectorAll('td').forEach((td) => { md += `| ${td.textContent.trim()} `; });
        md += '|\n';
      });

      return md;
    }

    return inner();
  }

  function toMd(el) {
    return nodeToMd(el).replace(/\n{3,}/g, '\n\n').trim();
  }

  function extractGeminiImages(queryEl) {
    const imgs = queryEl.querySelectorAll('img[data-test-id="uploaded-img"]');
    if (!imgs.length) return null;

    return [
      '**Attached images:**',
      ...Array.from(imgs).map((img, i) =>
        `- Attached image ${i + 1}: ${img.alt || '(no alt text)'} - ${img.src.slice(0, 80)}...`
      ),
    ].join('\n');
  }

  function getGeminiModelName(responseEl) {
    const botName = responseEl.querySelector('.bot-name-text')?.textContent?.trim();
    const gemBadge = responseEl.querySelector('.bot-name-ugc-label')?.textContent?.trim();
    if (botName && gemBadge) return `${botName} (${gemBadge})`;
    if (botName) return botName;
    return 'Gemini';
  }

  function findGeminiScroller() {
    const candidates = [
      document.querySelector('#chat-history'),
      document.querySelector('.chat-history-scroll-container'),
      document.querySelector('infinite-scroller'),
      document.querySelector('chat-window-content'),
    ];

    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight + 50) return el;
    }

    return document.documentElement;
  }

  function triggerScrollEvent(el) {
    el.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: false }));
    el.dispatchEvent(new Event('wheel', { bubbles: true, cancelable: false }));
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
      const convs = document.querySelectorAll('.conversation-container');
      const first = convs[0];

      if (first) first.scrollIntoView({ behavior: 'instant', block: 'start' });
      scroller.scrollTop = 0;

      requestAnimationFrame(() => {
        triggerScrollEvent(scroller);
        if (scroller !== document.documentElement) triggerScrollEvent(document);
      });

      await wait(pollMs);

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const currentCount = document.querySelectorAll('.conversation-container').length;
      const currentHeight = findGeminiScroller().scrollHeight;
      setButtonState(`Loading... ${elapsed}s (${currentCount} msgs)`, true);

      if (Date.now() - startTime >= safetyMs) {
        console.warn('[Gemini Export] Safety timeout (10 min).');
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
    const btns = document.querySelectorAll(
      'button[data-test-id="thoughts-header-button"][aria-expanded="false"]'
    );

    if (!btns.length) return;
    setButtonState(`Expanding reasoning (${btns.length})...`, true);
    btns.forEach((btn) => btn.click());
    await wait(600);
  }

  async function exportGemini() {
    setButtonState('Loading Gemini thread...', true);
    await loadGeminiConversation();
    await expandGeminiReasoning();

    const rawTitle = document.querySelector('conversations-list div.selected')?.textContent?.trim()
      || document.title?.replace(' - Gemini', '').trim()
      || 'Gemini Conversation';

    const queries = Array.from(document.querySelectorAll('user-query-content'));
    const replies = Array.from(document.querySelectorAll('model-response'));
    const pairs = Math.min(queries.length, replies.length);

    if (pairs === 0 && !queries.length) throw new Error('No conversation found.');

    const modelName = replies[0]
      ? getGeminiModelName(replies[0].closest('response-container') || replies[0])
      : 'Gemini';

    const messages = [];

    for (let i = 0; i < pairs; i++) {
      const replyContainer = replies[i].closest('response-container') || replies[i];
      const thoughtsPanel = replies[i].querySelector('.thoughts-content');
      const messageContent = replies[i].querySelector('message-content') || replies[i];

      messages.push({
        user: toMd(queries[i]),
        attachments: extractGeminiImages(queries[i]),
        reasoning: thoughtsPanel?.textContent?.trim() || null,
        response: toMd(messageContent),
      });
    }

    if (queries.length > replies.length) {
      messages.push({
        user: toMd(queries.at(-1)),
        attachments: extractGeminiImages(queries.at(-1)),
        reasoning: null,
        response: null,
      });
    }

    const markdown = buildStructuredMarkdown({
      title: rawTitle,
      model: modelName,
      turns: messages.length,
      messages,
    });

    downloadMarkdown(markdown, rawTitle);
  }

  // ─── Claude export via native copy buttons ──────────────────────────────────
  function getClaudeTitle() {
    return document.querySelector(CLAUDE_SELECTORS.conversationTitle)?.textContent?.trim()
      || document.title?.replace(/\s*\|\s*Claude$/, '').trim()
      || document.title?.replace(/\s*-\s*Claude$/, '').trim()
      || 'Claude Conversation';
  }

  function findClaudeScroller() {
    const candidates = [
      document.querySelector('[data-radix-scroll-area-viewport]'),
      document.querySelector('main'),
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
        console.warn('[Claude Export] Safety timeout reached while loading history.');
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
      btn.scrollIntoView({ behavior: 'instant', block: 'center' });
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

    if (!navigator.clipboard || typeof originalWriteText !== 'function') {
      throw new Error('Clipboard API is unavailable in this browser context.');
    }

    let currentTarget = humanMessages;

    try {
      navigator.clipboard.writeText = async (text) => {
        if (typeof text === 'string' && text.trim()) {
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
        throw new Error('No Claude messages were found in the current thread.');
      }

      currentTarget = humanMessages;
      await captureClaudeMessages(humanButtons, humanMessages, 'Copying user messages');

      currentTarget = modelMessages;
      await captureClaudeMessages(claudeButtons, modelMessages, 'Copying Claude responses');

      return { humanMessages, modelMessages };
    } finally {
      try {
        navigator.clipboard.writeText = originalWriteText;
      } catch (error) {
        console.warn('[Claude Export] Failed to restore clipboard.writeText', error);
      }
    }
  }

  async function exportClaude() {
    setButtonState('Loading Claude thread...', true);
    await loadClaudeConversation();

    const title = getClaudeTitle();
    const { humanMessages, modelMessages } = await captureClaudeConversation();
    const pairCount = Math.min(humanMessages.length, modelMessages.length);

    if (pairCount === 0 && !humanMessages.length) {
      throw new Error('No Claude messages could be captured.');
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
      model: 'Claude',
      turns: messages.length,
      messages,
    });

    downloadMarkdown(markdown, title);
  }

  // ─── ChatGPT export via DOM traversal ───────────────────────────────────────
  function getChatGPTTitle() {
    const cleanedTitle = document.title
      ?.replace(/\s*\|\s*ChatGPT$/, '')
      ?.replace(/\s*-\s*ChatGPT$/, '')
      ?.trim();

    if (cleanedTitle && cleanedTitle !== 'ChatGPT') return cleanedTitle;

    const firstUser = document.querySelector(`${CHATGPT_SELECTORS.roleNode}[data-message-author-role="user"]`);
    const preview = firstUser?.textContent?.trim()?.replace(/\s+/g, ' ');
    if (preview) return preview.slice(0, 80);

    return 'ChatGPT Conversation';
  }

  function getChatGPTModelName() {
    const badge = document.querySelector(CHATGPT_SELECTORS.modelBadge)?.textContent?.trim();
    return badge || 'ChatGPT';
  }

  function getChatGPTTurnNodes() {
    const turns = Array.from(document.querySelectorAll(CHATGPT_SELECTORS.turn));
    if (turns.length) return turns;

    const roleNodes = Array.from(document.querySelectorAll(CHATGPT_SELECTORS.roleNode));
    return roleNodes
      .map((node) => node.closest('article') || node.closest('div[data-testid^="conversation-turn-"]') || node)
      .filter((node, index, arr) => arr.indexOf(node) === index);
  }

  function findScrollableAncestor(node) {
    let current = node?.parentElement;

    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      const canScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';

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
      firstTurn?.closest('main')?.querySelector('section')?.parentElement,
      document.querySelector('main'),
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
        firstTurn.scrollIntoView({ behavior: 'instant', block: 'start' });
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
        console.warn('[ChatGPT Export] Safety timeout reached while loading history.');
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
    clone.querySelectorAll('button, nav, form, textarea, input, svg, script, style').forEach((el) => el.remove());
    return clone;
  }

  function extractChatGPTAttachments(roleNode) {
    const images = roleNode.querySelectorAll('img');
    if (!images.length) return null;

    return [
      '**Attached images:**',
      ...Array.from(images).map((img, i) =>
        `- Attached image ${i + 1}: ${img.alt || '(no alt text)'} - ${img.src.slice(0, 80)}...`
      ),
    ].join('\n');
  }

  function extractChatGPTMessages() {
    const turns = getChatGPTTurnNodes();
    const messages = [];
    let pendingUser = null;

    for (const turn of turns) {
      const roleNode = turn.matches(CHATGPT_SELECTORS.roleNode)
        ? turn
        : turn.querySelector(CHATGPT_SELECTORS.roleNode);
      const role = roleNode?.getAttribute('data-message-author-role');
      if (!roleNode || !role) continue;

      const contentNode = role === 'assistant'
        ? roleNode.querySelector(CHATGPT_SELECTORS.assistantContent) || roleNode
        : roleNode;
      const cleaned = cloneChatGPTRoleNode(contentNode);
      const content = toMd(cleaned);

      if (!content) continue;

      if (role === 'user') {
        if (pendingUser) messages.push(pendingUser);
        pendingUser = {
          user: content,
          attachments: extractChatGPTAttachments(roleNode),
          reasoning: null,
          response: null,
        };
        continue;
      }

      if (role === 'assistant') {
        if (pendingUser) {
          pendingUser.response = content;
          messages.push(pendingUser);
          pendingUser = null;
        } else {
          messages.push({
            user: '*(missing user message)*',
            reasoning: null,
            response: content,
          });
        }
      }
    }

    if (pendingUser) messages.push(pendingUser);
    return messages;
  }

  async function exportChatGPT() {
    setButtonState('Loading ChatGPT thread...', true);
    await loadChatGPTConversation();

    const title = getChatGPTTitle();
    const messages = extractChatGPTMessages();

    if (!messages.length) {
      throw new Error('No ChatGPT messages were found in the current thread.');
    }

    const markdown = buildStructuredMarkdown({
      title,
      model: getChatGPTModelName(),
      turns: messages.length,
      messages,
    });

    downloadMarkdown(markdown, title);
  }

  // ─── Shared UI ──────────────────────────────────────────────────────────────
  function createUI() {
    const container = document.createElement('div');
    container.id = UI_IDS.container;

    const isGemini = APP === 'gemini';
    const isChatGPT = APP === 'chatgpt';
    const background = isGemini
      ? 'var(--gemini-sys-color-surface-container-high, #1e1e1e)'
      : isChatGPT ? '#1f1f1f' : '#2a2623';
    const foreground = isGemini
      ? 'var(--gemini-sys-color-on-surface, #e3e3e3)'
      : isChatGPT ? '#ececec' : '#f8f3eb';
    const border = isGemini
      ? 'rgba(255, 255, 255, 0.08)'
      : isChatGPT ? 'rgba(255, 255, 255, 0.08)' : 'rgba(248, 243, 235, 0.1)';
    const hover = isGemini
      ? 'rgba(255, 255, 255, 0.04)'
      : isChatGPT ? 'rgba(255, 255, 255, 0.04)' : 'rgba(248, 243, 235, 0.05)';
    const fontFamily = isGemini
      ? '"Google Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      : isChatGPT ? 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      : 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    Object.assign(container.style, {
      position: 'fixed',
      top: '50%',
      right: '-142px',
      transform: 'translateY(-50%)',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      transition: 'right 0.22s ease-in-out',
      fontFamily,
    });

    const tab = document.createElement('div');
    Object.assign(tab.style, {
      backgroundColor: background,
      color: foreground,
      padding: '15px 8px',
      borderTopLeftRadius: '14px',
      borderBottomLeftRadius: '14px',
      cursor: 'pointer',
      boxShadow: '0 8px 18px rgba(0,0,0,0.12)',
      fontSize: '12px',
      fontWeight: '600',
      borderRight: 'none',
      borderTop: `1px solid ${border}`,
      borderLeft: `1px solid ${border}`,
      borderBottom: `1px solid ${border}`,
      userSelect: 'none',
    });
    tab.textContent = '◀';

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      minWidth: '142px',
      backgroundColor: background,
      borderTop: `1px solid ${border}`,
      borderRight: `1px solid ${border}`,
      borderBottom: `1px solid ${border}`,
      borderTopRightRadius: '14px',
      borderBottomRightRadius: '14px',
      boxShadow: '0 8px 18px rgba(0,0,0,0.12)',
      overflow: 'hidden',
    });

    const btn = document.createElement('button');
    btn.id = UI_IDS.button;
    btn.textContent = 'Export .md';
    Object.assign(btn.style, {
      width: '100%',
      backgroundColor: 'transparent',
      color: foreground,
      border: 'none',
      padding: '15px 18px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
      fontFamily: 'inherit',
      whiteSpace: 'nowrap',
      textAlign: 'center',
      transition: 'background-color 0.16s ease, opacity 0.16s ease',
    });

    container.appendChild(tab);
    panel.appendChild(btn);
    container.appendChild(panel);

    container.addEventListener('mouseenter', () => {
      container.style.right = '0px';
      tab.textContent = '▶';
      btn.style.backgroundColor = hover;
    });

    container.addEventListener('mouseleave', () => {
      container.style.right = '-142px';
      tab.textContent = '◀';
      btn.style.backgroundColor = 'transparent';
    });

    btn.addEventListener('click', runExport);
    return container;
  }

  function inject() {
    if (!document.body || document.getElementById(UI_IDS.container)) return;
    document.body.appendChild(createUI());
    console.log(`[${getAppLabel()} Export] v0.3.0 ready`);
  }

  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();
