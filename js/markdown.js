/*
 * Безопасный мини-markdown для ответов ассистента.
 * Сначала экранируется весь HTML, потом размечаются блоки кода, `код`, **жирный**, списки и заголовки.
 */

import { escapeHtml } from './dom.js';

const FENCE = /```([a-zA-Z0-9+#-]*)\n([\s\S]*?)```/g;

function inline(text) {
  return text
    .replace(/`([^`\n]+)`/g, (_all, code) => `<code class="md-inline">${code}</code>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1<em>$2</em>');
}

function blockLines(block) {
  const lines = block.split('\n');
  const html = [];
  let list = null;

  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      closeList();
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    const heading = line.match(/^(#{1,4})\s+(.*)$/);

    if (bullet || ordered) {
      const tag = bullet ? 'ul' : 'ol';
      if (list !== tag) {
        closeList();
        html.push(`<${tag} class="md-list">`);
        list = tag;
      }
      html.push(`<li>${inline(escapeHtml((bullet || ordered)[1]))}</li>`);
      continue;
    }

    closeList();
    if (heading) {
      const level = Math.min(heading[1].length, 3) + 3;
      html.push(`<h${level} class="md-h">${inline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }
    html.push(`<p class="md-p">${inline(escapeHtml(line))}</p>`);
  }
  closeList();
  return html.join('');
}

/* Возвращает HTML-строку. Весь пользовательский текст экранируется. */
export function renderMarkdown(text) {
  const source = String(text ?? '');
  let result = '';
  let lastIndex = 0;
  FENCE.lastIndex = 0;

  let match = FENCE.exec(source);
  while (match) {
    result += blockLines(source.slice(lastIndex, match.index));
    const lang = match[1] || 'text';
    const code = escapeHtml(match[2].replace(/\s+$/, ''));
    result += [
      '<div class="md-code">',
      `<div class="md-code__head"><span class="md-code__lang">${escapeHtml(lang)}</span>`,
      '<button class="md-copy" type="button" data-copy>Копировать</button></div>',
      `<pre class="md-code__body"><code>${code}</code></pre>`,
      '</div>',
    ].join('');
    lastIndex = match.index + match[0].length;
    match = FENCE.exec(source);
  }

  result += blockLines(source.slice(lastIndex));
  return result;
}

/* Готовит HTML к вставке: дописывает классы для сообщений чата. */
export function renderChatMessage(text) {
  return renderMarkdown(text)
    .replace(/<p class="md-p">/g, '<p>')
    .replace(/<ul class="md-list">/g, '<ul>')
    .replace(/<ol class="md-list">/g, '<ol>');
}
