/*
 * Kaitos v0.1.0 — точка входа.
 * Собирает модули приложения и связывает их между собой: файловая система,
 * редактор, дерево файлов, чат, терминал, настройки и палитра команд.
 */

import { $, formatTime } from './dom.js';
import { createFs } from './fs.js';
import { initEditor } from './editor.js';
import { initTree } from './tree.js';
import { initChat } from './chat.js';
import { initTerminal } from './terminal.js';
import { initSettings, loadSettings, saveSettings, applySettings } from './settings.js';
import { initPalette } from './palette.js';

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
  ctx.palette = initPalette(ctx);

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
  $('#btn-palette').addEventListener('click', () => ctx.palette.open());

  startClock();

  ctx.ready = true;
  window.Kaitos = ctx;
}

boot();
