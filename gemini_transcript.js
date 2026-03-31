// ==UserScript==
// @name         Gemini Transcript Exporter (LLM Optimized)
// @description  Exports Gemini conversations to a structured Markdown format optimized for LLM ingestion.
// @version      8.0.0
// @author       you
// @namespace    gemini-export-md
// @include      *://gemini.google.com/*
// @noframes
// @license      MIT
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ─── Converte nó DOM em Markdown (zero innerHTML) ───────────────────────────
  function nodeToMd(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();

    if (['script','style','button','mat-icon','svg'].includes(tag)) return '';
    if (node.classList?.contains('katex-html')) return '';
    if (tag === 'mrow') return '';

    // LaTeX
    if (tag === 'annotation' && node.getAttribute('encoding') === 'application/x-tex') {
      const latex = node.textContent.trim();
      return node.closest('.katex-display') ? `\n$$\n${latex}\n$$\n` : `$${latex}$`;
    }

    // Code block (Gemini custom element)
    if (tag === 'code-block') {
      const lang = node.querySelector('div > div > span')?.textContent?.trim() || '';
      const pre  = node.querySelector('div > div:nth-child(2) > div > pre');
      return `\n\`\`\`${lang}\n${pre ? pre.textContent : node.textContent}\n\`\`\`\n`;
    }

    const inner = () => Array.from(node.childNodes).map(nodeToMd).join('');

    if (tag === 'strong' || tag === 'b') return `**${node.textContent}**`;
    if (tag === 'em'     || tag === 'i') return `*${node.textContent}*`;
    if (tag === 'code'   && node.closest('p,li')) return `\`${node.textContent}\``;
    if (tag === 'a')  return `[${node.textContent}](${node.href})`;
    if (tag === 'img') return `[Image: ${node.alt || node.src}]`;
    if (tag === 'hr')  return '\n---\n';
    if (tag === 'br')  return '\n';
    if (tag === 'p')   return `\n${inner()}\n`;

    for (let i = 1; i <= 6; i++)
      if (tag === `h${i}`) return `\n${'#'.repeat(i)} ${node.textContent.trim()}\n`;

    if (tag === 'ul') {
      return '\n' + Array.from(node.querySelectorAll(':scope > li'))
        .map(li => `- ${li.textContent.trim()}`).join('\n') + '\n';
    }
    if (tag === 'ol') {
      return '\n' + Array.from(node.querySelectorAll(':scope > li'))
        .map((li, i) => `${i + 1}. ${li.textContent.trim()}`).join('\n') + '\n';
    }
    if (tag === 'table') {
      let md = '\n';
      node.querySelectorAll('thead tr').forEach(tr => {
        tr.querySelectorAll('th').forEach(th => md += `| ${th.textContent.trim()} `);
        md += '|\n';
        tr.querySelectorAll('th').forEach(() => md += '| --- ');
        md += '|\n';
      });
      node.querySelectorAll('tbody tr').forEach(tr => {
        tr.querySelectorAll('td').forEach(td => md += `| ${td.textContent.trim()} `);
        md += '|\n';
      });
      return md;
    }

    return inner();
  }

  function toMd(el) {
    return nodeToMd(el).replace(/\n{3,}/g, '\n\n').trim();
  }

  // ─── Extrai imagens anexadas a uma user-query ────────────────────────────────
  function extractImages(queryEl) {
    const imgs = queryEl.querySelectorAll('img[data-test-id="uploaded-img"]');
    if (!imgs.length) return null;
    return Array.from(imgs).map((img, i) =>
      `- Attached image ${i + 1}: ${img.alt || '(no alt text)'} — ${img.src.slice(0, 80)}...`
    ).join('\n');
  }

  // ─── Expande e extrai raciocínio (model-thoughts) ───────────────────────────
  function extractReasoning(responseEl) {
    const thoughtsBtn = responseEl.querySelector('button[data-test-id="thoughts-header-button"]');
    if (!thoughtsBtn) return null;

    const isExpanded = thoughtsBtn.getAttribute('aria-expanded') === 'true';
    if (!isExpanded) {
      thoughtsBtn.click();
    }

    const panel = responseEl.querySelector('.thoughts-content');
    if (!panel || !panel.textContent.trim()) return null;
    return panel.textContent.trim();
  }

  // ─── Detecta nome do modelo/gem usado ───────────────────────────────────────
  function getModelName(responseEl) {
    const botName = responseEl.querySelector('.bot-name-text')?.textContent?.trim();
    const gemBadge = responseEl.querySelector('.bot-name-ugc-label')?.textContent?.trim();
    if (botName && gemBadge) return `${botName} (${gemBadge})`;
    if (botName) return botName;
    return 'Gemini';
  }

  // ─── Encontra o container scrollável do chat ────────────────────────────────
  function findScroller() {
    const candidates = [
      document.querySelector('#chat-history'),
      document.querySelector('.chat-history-scroll-container'),
      document.querySelector('infinite-scroller'),
      document.querySelector('chat-window-content'),
    ];
    for (const el of candidates) {
      if (el && el.scrollHeight > el.clientHeight + 50) {
        return el;
      }
    }
    return document.documentElement;
  }

  // ─── Dispara evento de scroll real no elemento ──────────────────────────────
  function triggerScrollEvent(el) {
    el.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: false }));
    el.dispatchEvent(new Event('wheel',  { bubbles: true, cancelable: false }));
  }

  // ─── Carrega toda a conversa e exporta ──────────────────────────────────────
  function scrollAndExport() {
    const btn = document.getElementById('gemini-export-md-btn');
    if (btn) { btn.textContent = 'Loading... 0s'; btn.style.opacity = '0.5'; }

    const POLL_MS       = 600;
    const STABLE_NEEDED = 4;
    const SAFETY_MS     = 10 * 60 * 1000;

    let lastCount   = -1;
    let lastHeight  = -1;
    let stableCount = 0;
    const startTime = Date.now();

    function updateLabel() {
      if (!btn) return;
      const secs  = Math.round((Date.now() - startTime) / 1000);
      const count = document.querySelectorAll('.conversation-container').length;
      btn.textContent = `Loading... ${secs}s (${count} msgs)`;
    }

    function finish() {
      const secs  = Math.round((Date.now() - startTime) / 1000);
      const count = document.querySelectorAll('.conversation-container').length;
      console.log(`[Gemini Export] Done in ${secs}s — ${count} conversation blocks loaded.`);
      expandAllReasoning(() => {
        doExport();
        if (btn) { btn.textContent = 'Export .md'; btn.style.opacity = '1'; }
      });
    }

    function cycle() {
      const scroller = findScroller();
      const convs    = document.querySelectorAll('.conversation-container');
      const first    = convs[0];

      if (first) {
        first.scrollIntoView({ behavior: 'instant', block: 'start' });
      }

      scroller.scrollTop = 0;

      requestAnimationFrame(() => {
        triggerScrollEvent(scroller);
        if (scroller !== document.documentElement) {
          triggerScrollEvent(document);
        }
      });

      setTimeout(() => {
        updateLabel();

        if (Date.now() - startTime >= SAFETY_MS) {
          console.warn('[Gemini Export] Safety timeout (10 min).');
          finish();
          return;
        }

        const currentCount  = document.querySelectorAll('.conversation-container').length;
        const currentHeight = findScroller().scrollHeight;

        if (currentCount !== lastCount || currentHeight !== lastHeight) {
          lastCount   = currentCount;
          lastHeight  = currentHeight;
          stableCount = 0;
          cycle();
        } else {
          stableCount++;
          if (stableCount >= STABLE_NEEDED) {
            finish();
          } else {
            cycle();
          }
        }
      }, POLL_MS);
    }

    setTimeout(cycle, 300);
  }

  // ─── Expande todos os blocos de raciocínio e aguarda ────────────────────────
  function expandAllReasoning(callback) {
    const btns = document.querySelectorAll(
      'button[data-test-id="thoughts-header-button"][aria-expanded="false"]'
    );

    if (!btns.length) { callback(); return; }

    btns.forEach(b => b.click());
    setTimeout(callback, 600);
  }

  // ─── Exportação Estruturada para LLM ─────────────────────────────────────────
  function doExport() {
    const rawTitle = document.querySelector('conversations-list div.selected')?.textContent?.trim()
                || document.title?.replace(' - Gemini','').trim()
                || 'Gemini Conversation';

    const queries  = [...document.querySelectorAll('user-query-content')];
    const replies  = [...document.querySelectorAll('model-response')];
    const pairs    = Math.min(queries.length, replies.length);

    if (pairs === 0) { alert('No conversation found.'); return; }

    const modelName = replies[0]
      ? getModelName(replies[0].closest('response-container') || replies[0])
      : 'Gemini';

    const dateObj = new Date();
    const exportDate = dateObj.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
    const fileTimestamp = dateObj.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

    let md = `---
Title: ${rawTitle}
Date: ${exportDate}
Model: ${modelName}
Turns: ${pairs}
---

> **[SYSTEM DIRECTIVE FOR CONSUMING LLM]**
> This document contains a structured transcript of an interaction between a human user and an AI model.
> You must parse this document using the following strict block delimiters:
> - \`::USER_MESSAGE::\` indicates the start of the human's input.
> - \`::MODEL_REASONING::\` indicates the start of the AI's internal thought process.
> - \`::MODEL_RESPONSE::\` indicates the start of the AI's final output.
> - \`::END_TURN::\` indicates the conclusion of a single interaction pair.
> Treat these boundaries strictly to maintain context.

\n\n`;

    for (let i = 0; i < pairs; i++) {
      md += `::USER_MESSAGE::\n`;
      const images = extractImages(queries[i]);
      if (images) md += `**Attached images:**\n${images}\n\n`;
      md += toMd(queries[i]) + '\n\n';

      const replyContainer = replies[i].closest('response-container') || replies[i];
      const thoughtsPanel = replies[i].querySelector('.thoughts-content');

      if (thoughtsPanel && thoughtsPanel.textContent.trim()) {
        md += `::MODEL_REASONING::\n`;
        md += thoughtsPanel.textContent.trim() + '\n\n';
      }

      md += `::MODEL_RESPONSE::\n`;
      const messageContent = replies[i].querySelector('message-content') || replies[i];
      md += toMd(messageContent) + '\n\n';

      md += `::END_TURN::\n\n`;
    }

    if (queries.length > replies.length) {
      md += `::USER_MESSAGE::\n`;
      const images = extractImages(queries.at(-1));
      if (images) md += `**Attached images:**\n${images}\n\n`;
      md += toMd(queries.at(-1)) + '\n\n';
      md += `*(no response yet)*\n\n::END_TURN::\n\n`;
    }

    const safeTitle = rawTitle.replace(/[\/\\\?\%\*\:\|"<>\.]/g, '_').replace(/\s+/g, '_').slice(0, 50);
    const fname = `${safeTitle}_${fileTimestamp}.md`;

    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    const a   = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  // ─── Interface de Gaveta Oculta ──────────────────────────────────────────────
  function createUI() {
    const container = document.createElement('div');
    container.id = 'gemini-export-md-container';

    Object.assign(container.style, {
      position: 'fixed',
      top: '50%',
      right: '-140px',
      transform: 'translateY(-50%)',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      transition: 'right 0.25s ease-in-out',
      fontFamily: '"Google Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    });

    const tab = document.createElement('div');
    tab.textContent = '◀';
    Object.assign(tab.style, {
      backgroundColor: 'var(--gemini-sys-color-surface-container-high, #1e1e1e)',
      color: 'var(--gemini-sys-color-on-surface, #e3e3e3)',
      padding: '16px 8px',
      borderTopLeftRadius: '12px',
      borderBottomLeftRadius: '12px',
      cursor: 'pointer',
      boxShadow: '-2px 0 8px rgba(0,0,0,0.15)',
      fontSize: '12px'
    });

    const btn = document.createElement('button');
    btn.id = 'gemini-export-md-btn';
    btn.textContent = 'Export .md';
    Object.assign(btn.style, {
      backgroundColor: 'var(--gemini-sys-color-surface-container-high, #1e1e1e)',
      color: 'var(--gemini-sys-color-on-surface, #e3e3e3)',
      border: 'none',
      padding: '16px 20px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
      fontFamily: 'inherit',
      borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
      minWidth: '140px',
      whiteSpace: 'nowrap',
      textAlign: 'center'
    });

    container.appendChild(tab);
    container.appendChild(btn);

    container.addEventListener('mouseenter', () => {
        container.style.right = '0px';
        tab.textContent = '▶';
    });

    container.addEventListener('mouseleave', () => {
        container.style.right = '-140px';
        tab.textContent = '◀';
    });

    btn.addEventListener('click', scrollAndExport);
    return container;
  }

  function inject() {
    if (document.getElementById('gemini-export-md-container')) return;
    document.body.appendChild(createUI());
    console.log('[Gemini Export] v8.0.0 ready');
  }

  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);

})();