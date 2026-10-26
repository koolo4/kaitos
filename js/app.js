/*
 * Kaitos v0.1.0 — точка входа.
 * Собирает модули приложения и связывает их между собой: файловая система,
 * редактор, дерево файлов, чат, терминал, настройки и палитра команд.
 */

import { $, formatTime, toast } from './dom.js';
import { createFs } from './fs.js';
import { initEditor } from './editor.js';
import { initTree } from './tree.js';
import { initChat } from './chat.js';
import { initTerminal } from './terminal.js';
import { initSettings, loadSettings, saveSettings, applySettings } from './settings.js';
import { initPalette } from './palette.js';
import { initGit } from './git.js';
import { createLlm } from './llm.js';
import { createApi } from './api.js';
import { createRemoteFs } from './fs-remote.js';

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

/* Пробует подключиться к локальному серверу файлов; при неудаче остаётся демо-режим. */
async function connectStorage() {
  const baseUrl = ctx.settings.serverUrl || '/api';
  const api = createApi({ baseUrl, token: ctx.settings.serverToken || '' });
  ctx.api = api;

  if (typeof fetch !== 'function') return { mode: 'demo', reason: 'нет fetch' };

  try {
    const health = await api.health();
    if (health.warning) ctx.storageWarning = health.warning;
    const remote = createRemoteFs({ api, name: health.root || 'project' });
    const stats = await remote.load();
    ctx.fs = remote;
    return { mode: 'disk', name: remote.name(), files: stats.files, skipped: stats.skipped };
  } catch (error) {
    return { mode: 'demo', reason: error.message };
  }
}

/* Подхватывает правки, сделанные мимо Kaitos: другой редактор, git, скрипт. */
function startWatchingDisk(storage) {
  if (storage.mode !== 'disk' || !ctx.fs.startSync) return;

  ctx.fs.startSync({
    intervalMs: 1500,
    dirty: (path) => Boolean(ctx.editor && ctx.editor.isDirty(path)),
    onChange: ({ applied, skipped }) => {
      if (ctx.tree) ctx.tree.render();
      for (const item of applied) {
        if (ctx.editor) ctx.editor.reloadFromDisk(item.path);
        if (ctx.editor && ctx.editor.tabs.includes(item.path)) ctx.editor.renderTabs();
      }
      if (applied.length && ctx.terminal) {
        const names = applied.map((item) => item.path).join(', ');
        ctx.terminal.print(`Изменено на диске: ${names}`, 'muted');
      }
      if (skipped.length) {
        const names = skipped.join(', ');
        if (ctx.terminal) ctx.terminal.print(`Конфликт: на диске изменён файл с несохранёнными правками: ${names}`, 'warn');
        toast(`Конфликт правок: ${names}. Несохранённый текст оставлен без изменений.`, 'warn', 7000);
      }
    },
  });
}

function showStorage(state) {
  const chip = $('#status-storage');
  if (chip) {
    if (state.mode === 'disk') {
      chip.textContent = `диск: ${state.name}${state.skipped ? ` (${state.files} файлов)` : ''}`;
      chip.title = 'Файлы читаются с диска через локальный сервер';
      chip.classList.add('status-item--ok');
    } else {
      chip.textContent = 'демо (в памяти)';
      chip.title = `Локальный сервер не подключён: ${state.reason || ''}. Запустите npm run server`;
      chip.classList.remove('status-item--ok');
    }
  }
  if (state.mode === 'disk' && ctx.editor && ctx.editor.renderHighlight) ctx.editor.renderHighlight();
}

async function boot() {
  applySettings(ctx.settings);

  const storage = await connectStorage();

  ctx.llm = createLlm(ctx);
  ctx.editor = initEditor(ctx);
  ctx.tree = initTree(ctx);
  ctx.chat = initChat(ctx);
  ctx.terminal = initTerminal(ctx);
  ctx.settingsApi = initSettings(ctx);
  ctx.palette = initPalette(ctx);
  ctx.git = initGit(ctx);

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

  $('#project-name').textContent = ctx.fs.name();
  if (ctx.tree) ctx.tree.render();
  showStorage(storage);
  if (storage.mode === 'disk' && ctx.terminal) {
    ctx.terminal.print(`Проект с диска: ${storage.name}, файлов ${storage.files}`, 'ok');
    ctx.terminal.print('Терминал выполняет настоящие команды в папке проекта. help — подсказка, Ctrl+L — очистить.', 'muted');
  }

  if (ctx.storageWarning && ctx.terminal) {
    ctx.terminal.print(ctx.storageWarning, 'err');
  }

  startWatchingDisk(storage);

  ctx.ready = true;
  ctx.storage = storage;
  if (ctx.git) ctx.git.refresh();
  window.Kaitos = ctx;
  window.dispatchEvent(new window.CustomEvent('kaitos:ready', { detail: storage }));
}

window.Kaitos = ctx;
boot();
