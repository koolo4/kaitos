Цель: Сделать модальное окно настроек: провайдер модели (Ollama / OpenAI-совместимый / без модели), имя модели, адрес API, ключ, тема, размер шрифта. Всё хранится в localStorage браузера.

Проект: Kaitos — AI-редактор кода в браузере (аналог Cursor / Claude Code).
Стек: Vite 5 + ванильный JavaScript, ES-модули. Все файлы — в корне репозитория.
Файл `index.html` уже существует, его менять нельзя: в нём зафиксированы id элементов.

Требования:

1. Новый файл — `js/settings.js`, второй файл заменяет точку входа `js/app.js`.
2. Создай файл `js/settings.js` с текстом ниже — инструментом write_file. Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/* Настройки: провайдер модели, тема, размер шрифта. Хранятся в localStorage браузера. */

import { $ } from './dom.js';

const STORAGE_KEY = 'kaitos.settings.v1';

export const DEFAULT_SETTINGS = {
  provider: 'none',
  model: '',
  baseUrl: '',
  apiKey: '',
  theme: 'dark',
  fontSize: 13,
};

export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    /* приватный режим браузера — настройки просто не сохранятся */
  }
}

export function applySettings(settings) {
  document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  document.documentElement.style.setProperty('--code-size', `${Number(settings.fontSize) || 13}px`);

  const chip = $('#model-chip');
  if (chip) chip.textContent = settings.model ? settings.model : 'модель не выбрана';

  const status = $('#status-model');
  if (status) status.textContent = settings.model ? `модель: ${settings.model}` : 'модель: —';
}

export function initSettings(ctx) {
  const modal = $('#settings-modal');
  const fields = {
    provider: $('#settings-provider'),
    model: $('#settings-model'),
    baseUrl: $('#settings-baseurl'),
    apiKey: $('#settings-apikey'),
    theme: $('#settings-theme'),
    fontSize: $('#settings-fontsize'),
  };

  function fill(settings) {
    fields.provider.value = settings.provider;
    fields.model.value = settings.model;
    fields.baseUrl.value = settings.baseUrl;
    fields.apiKey.value = settings.apiKey;
    fields.theme.value = settings.theme;
    fields.fontSize.value = String(settings.fontSize);
  }

  function open() {
    fill(ctx.settings);
    modal.hidden = false;
    fields.model.focus();
  }

  function close() {
    modal.hidden = true;
  }

  function save() {
    ctx.updateSettings({
      provider: fields.provider.value,
      model: fields.model.value.trim(),
      baseUrl: fields.baseUrl.value.trim(),
      apiKey: fields.apiKey.value,
      theme: fields.theme.value,
      fontSize: Number(fields.fontSize.value) || 13,
    });
    close();
  }

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close="settings"]')) close();
  });

  $('#settings-save').addEventListener('click', save);
  $('#btn-settings').addEventListener('click', open);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      event.preventDefault();
      close();
    }
  });

  return { open, close, save, fill };
}
````

3. Замени всё содержимое файла `js/app.js` на текст ниже — инструментом write_file (не edit_file). Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/*
 * Kaitos v0.1.0 — точка входа.
 * Подключены все панели и настройки. Палитра команд — следующая задача.
 */

import { $, formatTime } from './dom.js';
import { createFs } from './fs.js';
import { initEditor } from './editor.js';
import { initTree } from './tree.js';
import { initChat } from './chat.js';
import { initTerminal } from './terminal.js';
import { initSettings, loadSettings, saveSettings, applySettings } from './settings.js';

const VERSION = '0.1.0';

const ctx = {
  version: VERSION,
  fs: createFs(),
  settings: loadSettings(),
  ready: false,
};

function updateSettings(patch) {
  ctx.settings = { ...ctx.settings, ...patch };
  saveSettings(ctx.settings);
  applySettings(ctx.settings);
}

function toggleSidebar() {
  const app = $('#app');
  const collapsed = app.classList.toggle('sidebar-collapsed');
  $('#btn-sidebar-toggle').textContent = collapsed ? '»' : '«';
}

function toggleTerminal() {
  const main = $('#main-area');
  const collapsed = main.classList.toggle('is-terminal-collapsed');
  $('#btn-terminal-toggle').textContent = collapsed ? '⌃' : '⌄';
}

function startClock() {
  const clock = $('#status-clock');
  const tick = () => {
    clock.textContent = formatTime();
  };
  tick();
  window.setInterval(tick, 1000);
}

function boot() {
  applySettings(ctx.settings);

  ctx.editor = initEditor(ctx);
  ctx.tree = initTree(ctx);
  ctx.chat = initChat(ctx);
  ctx.terminal = initTerminal(ctx);
  ctx.settingsApi = initSettings(ctx);

  ctx.updateSettings = updateSettings;
  ctx.toggleSidebar = toggleSidebar;
  ctx.toggleTerminal = toggleTerminal;

  $('#project-name').textContent = ctx.fs.name();
  $('#status-file').textContent = 'файл не открыт';

  ctx.editor.onChange((info) => {
    $('#status-file').textContent = info.path || 'файл не открыт';
    $('#status-dirty').textContent = info.dirty ? '● не сохранено' : '';
    $('#status-position').textContent = `Стр ${info.line}, Кол ${info.col}`;
    $('#chat-context').textContent = info.path || 'без файла';
  });

  $('#btn-theme').addEventListener('click', () => {
    updateSettings({ theme: ctx.settings.theme === 'dark' ? 'light' : 'dark' });
  });
  $('#btn-sidebar-toggle').addEventListener('click', toggleSidebar);
  $('#btn-terminal-toggle').addEventListener('click', toggleTerminal);
  $('#btn-terminal-clear').addEventListener('click', () => ctx.terminal.clear());

  startClock();

  ctx.ready = true;
  window.Kaitos = ctx;
}

boot();
````

4. Проверь в браузере: «Настройки» → модель `qwen2.5-coder:7b` → «Сохранить» → перезагрузи страницу: модель осталась.

Готово, когда:
- Кнопка «Настройки» открывает модалку `#settings-modal`, крестик и Esc закрывают её.
- Сохранение меняет чип `#model-chip` в верхней панели и `#status-model` в строке состояния.
- Тема из настроек применяется и переживает перезагрузку страницы (ключ хранилища `kaitos.settings.v1`).
- Размер шрифта кода из настроек меняет CSS-переменную `--code-size` (проверяется в консоли: `document.documentElement.style.getPropertyValue('--code-size')`).
- Кнопка «Тема» в верхней панели переключает тему через те же настройки.
- Команда `model` в терминале показывает выбранные провайдера и модель.

Не делать:
- Не отправляй никаких запросов в сеть — ключ только сохраняется в браузере.
- Не меняй index.html, css-файлы и другие js-модули, кроме `js/app.js`.
- Не создавай палитру команд — это следующая задача.
