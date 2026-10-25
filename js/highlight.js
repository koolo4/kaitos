/*
 * Подсветка синтаксиса без зависимостей.
 * highlight(code, lang) возвращает HTML-строку: весь текст экранирован,
 * разметка — только теги <span class="tok-…">.
 *
 * Поддерживаются: js/ts, css, html, json, md, sh. Неизвестный язык — простой текст.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeCode(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

const KEYWORDS = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'break', 'continue', 'new', 'class', 'extends', 'super', 'this', 'typeof', 'instanceof', 'in', 'of',
  'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield', 'import', 'export', 'from', 'as',
  'default', 'delete', 'void', 'null', 'undefined', 'true', 'false',
];

// Один проход по строке: комментарии, строки, числа, ключевые слова, вызовы, свойства.
const JS_PATTERN = new RegExp(
  [
    '(?<comment>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
    '(?<string>`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')',
    '(?<number>\\b\\d+(?:\\.\\d+)?\\b)',
    `(?<keyword>\\b(?:${KEYWORDS.join('|')})\\b)`,
    '(?<fn>\\b[A-Za-z_$][\\w$]*(?=\\s*\\())',
    '(?<prop>\\b[A-Za-z_$][\\w$]*(?=\\s*:))',
    '(?<punct>[{}()\\[\\];,.=+\\-*/%<>!&|?:]+)',
  ].join('|'),
  'g',
);

const CSS_PATTERN = /(?<comment>\/\*[\s\S]*?\*\/)|(?<selector>[^{}\/\n][^{}]*?(?=\s*\{))|(?<prop>[a-zA-Z-]+(?=\s*:))|(?<value>:[^;{}]+)|(?<punct>[{};])/g;
const HTML_PATTERN = /(?<comment><!--[\s\S]*?-->)|(?<tag><\/?[a-zA-Z][\w-]*)|(?<attr>[a-zA-Z-:]+(?==))|(?<string>"[^"]*"|'[^']*')|(?<punct><\/?|\/?>)/g;
const SH_PATTERN = /(?<comment>#[^\n]*)|(?<string>"[^"]*"|'[^']*')|(?<keyword>\b(?:if|then|fi|for|do|done|case|esac|function|echo|export|cd|npm|node|git)\b)|(?<punct>[$|;&(){}[\]<>]+)/g;

const CLASS_BY_GROUP = {
  comment: 'tok-comment',
  string: 'tok-string',
  number: 'tok-number',
  keyword: 'tok-keyword',
  fn: 'tok-fn',
  prop: 'tok-prop',
  selector: 'tok-selector',
  value: 'tok-value',
  tag: 'tok-tag',
  attr: 'tok-attr',
  punct: 'tok-punct',
};

function highlightWith(code, pattern) {
  const source = String(code ?? '');
  let out = '';
  let last = 0;
  pattern.lastIndex = 0;
  let match = pattern.exec(source);
  while (match) {
    if (match.index > last) out += escapeCode(source.slice(last, match.index));
    const groups = match.groups || {};
    let cssClass = '';
    for (const [name, value] of Object.entries(groups)) {
      if (value !== undefined) {
        cssClass = CLASS_BY_GROUP[name] || '';
        break;
      }
    }
    out += cssClass ? `<span class="${cssClass}">${escapeCode(match[0])}</span>` : escapeCode(match[0]);
    last = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex += 1; // защита от зацикливания
    match = pattern.exec(source);
  }
  out += escapeCode(source.slice(last));
  return out;
}

function highlightJson(code) {
  const source = String(code ?? '');
  let out = '';
  let last = 0;
  const pattern = /(?<attr>"(?:[^"\\]|\\.)*")(?=\s*:)|(?<string>"(?:[^"\\]|\\.)*")|(?<number>-?\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:true|false|null)\b)/g;
  let match = pattern.exec(source);
  while (match) {
    if (match.index > last) out += escapeCode(source.slice(last, match.index));
    const cls = match.groups.attr ? 'tok-prop' : match.groups.string ? 'tok-string' : match.groups.number ? 'tok-number' : 'tok-keyword';
    out += `<span class="${cls}">${escapeCode(match[0])}</span>`;
    last = match.index + match[0].length;
    match = pattern.exec(source);
  }
  out += escapeCode(source.slice(last));
  return out;
}

function highlightMarkdown(code) {
  const lines = String(code ?? '').split('\n');
  return lines
    .map((line) => {
      if (/^#{1,6}\s/.test(line)) return `<span class="tok-keyword">${escapeCode(line)}</span>`;
      if (/^\s*([-*+]|\d+\.)\s/.test(line)) return `<span class="tok-prop">${escapeCode(line)}</span>`;
      if (/^\s*>/.test(line)) return `<span class="tok-comment">${escapeCode(line)}</span>`;
      const escaped = escapeCode(line);
      return escaped
        .replace(/(&gt;|`[^`]*`)/g, (chunk) => (chunk.startsWith('`') ? `<span class="tok-string">${chunk}</span>` : chunk))
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="tok-fn">[$1]</span><span class="tok-string">($2)</span>');
    })
    .join('\n');
}

const LANGUAGE_ALIASES = {
  js: 'js', javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', cjs: 'js',
  css: 'css', scss: 'css',
  html: 'html', xml: 'html', vue: 'html',
  json: 'json', jsonc: 'json',
  md: 'md', markdown: 'md',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh',
};

export function detectLanguage(pathOrLang) {
  const value = String(pathOrLang ?? '').trim().toLowerCase();
  if (LANGUAGE_ALIASES[value]) return LANGUAGE_ALIASES[value];
  const ext = value.includes('.') ? value.split('.').pop() : '';
  return LANGUAGE_ALIASES[ext] || 'text';
}

export function highlight(code, lang = 'text') {
  const language = detectLanguage(lang);
  switch (language) {
    case 'js':
      return highlightWith(code, JS_PATTERN);
    case 'css':
      return highlightWith(code, CSS_PATTERN);
    case 'html':
      return highlightWith(code, HTML_PATTERN);
    case 'json':
      return highlightJson(code);
    case 'md':
      return highlightMarkdown(code);
    case 'sh':
      return highlightWith(code, SH_PATTERN);
    default:
      return escapeCode(code);
  }
}
