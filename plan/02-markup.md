Цель: Собрать весь экран приложения статической разметкой: верхняя панель, дерево файлов, редактор, чат, терминал, строка состояния, модалка настроек, палитра команд. И оживить каркас: часы, переключение темы, сворачивание панелей.

Проект: Kaitos — AI-редактор кода в браузере (аналог Cursor / Claude Code).
Стек: Vite 5 + ванильный JavaScript, ES-модули. Все файлы — в корне репозитория.
Файл `index.html` уже существует, его менять нельзя: в нём зафиксированы id элементов.

Требования:

1. В `index.html` все id элементов — контракт: по ним работают остальные модули и тесты, придумывать свои id нельзя.
2. Файлы `css/base.css` и `css/components.css` в этой задаче создавать НЕ нужно (они появятся в задаче 3), страница до тех пор будет без оформления — это нормально.
3. Замени всё содержимое файла `index.html` на текст ниже — инструментом write_file (не edit_file). Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
<!DOCTYPE html>
<html lang="ru" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kaitos — AI-редактор кода</title>
  <link rel="stylesheet" href="css/base.css" />
  <link rel="stylesheet" href="css/components.css" />
</head>
<body>
  <div id="app">
    <header id="titlebar">
      <div class="titlebar__left">
        <span class="logo" aria-hidden="true">◈</span>
        <span class="logo-text">Kaitos</span>
        <span class="badge" id="app-version">v0.1.0</span>
      </div>
      <nav class="titlebar__nav">
        <button class="btn-ghost" id="btn-palette" title="Палитра команд (Ctrl+K)">Команды</button>
        <button class="btn-ghost" id="btn-theme" title="Сменить тему">Тема</button>
        <button class="btn-ghost" id="btn-settings" title="Настройки">Настройки</button>
      </nav>
      <div class="titlebar__right">
        <span id="project-name" class="muted">проект не загружен</span>
        <span id="model-chip" class="chip">модель не выбрана</span>
      </div>
    </header>

    <div id="workbench">
      <aside id="sidebar">
        <div class="panel-head">
          <span class="panel-title">Файлы</span>
          <div class="panel-actions">
            <button class="btn-ghost btn-xs" id="btn-sidebar-toggle" title="Свернуть панель">«</button>
          </div>
        </div>
        <div id="file-tree" class="tree" role="tree"></div>
      </aside>

      <main id="main-area">
        <section id="editor-panel">
          <div id="tabs" class="tabs" role="tablist"></div>
          <div id="editor" class="editor">
            <div id="line-numbers" class="line-numbers" aria-hidden="true">1</div>
            <textarea id="editor-input" class="editor-input" spellcheck="false" autocomplete="off"
              placeholder="Выберите файл в панели «Файлы»"></textarea>
          </div>
          <div id="editor-empty" class="empty">Выберите файл слева, чтобы открыть его в редакторе</div>
        </section>

        <section id="terminal">
          <div class="panel-head">
            <span class="panel-title">Терминал</span>
            <div class="panel-actions">
              <button class="btn-ghost btn-xs" id="btn-terminal-clear">Очистить</button>
              <button class="btn-ghost btn-xs" id="btn-terminal-toggle" title="Свернуть терминал">⌄</button>
            </div>
          </div>
          <div id="terminal-body" class="terminal-body">
            <div id="terminal-output" class="terminal-output"></div>
            <form id="terminal-form" class="terminal-line">
              <span class="terminal-prompt" id="terminal-prompt">kaitos:~/demo $</span>
              <input id="terminal-input" class="terminal-input" autocomplete="off" spellcheck="false" />
            </form>
          </div>
        </section>
      </main>

      <aside id="chat">
        <div class="panel-head">
          <span class="panel-title">Ассистент</span>
          <span id="chat-context" class="chip chip-sm">без файла</span>
        </div>
        <div id="chat-messages" class="chat-messages"></div>
        <div id="chat-quick" class="chat-quick">
          <button class="chip chip-btn" type="button" data-prompt="Объясни этот файл">Объясни файл</button>
          <button class="chip chip-btn" type="button" data-prompt="Найди ошибки в коде">Найди ошибки</button>
          <button class="chip chip-btn" type="button" data-prompt="Добавь комментарии к коду">Комментарии</button>
        </div>
        <form id="chat-form" class="chat-form">
          <textarea id="chat-input" class="chat-input" rows="3" placeholder="Спросите о коде…"></textarea>
          <div class="chat-actions">
            <span class="muted small">Enter — отправить</span>
            <button id="chat-send" class="btn-primary" type="submit">Отправить</button>
          </div>
        </form>
      </aside>
    </div>

    <footer id="statusbar">
      <span id="status-file" class="status-item">файл не открыт</span>
      <span id="status-position" class="status-item">Стр 1, Кол 1</span>
      <span id="status-dirty" class="status-item"></span>
      <span class="status-spacer"></span>
      <span id="status-model" class="status-item">модель: —</span>
      <span id="status-clock" class="status-item">--:--</span>
    </footer>
  </div>

  <div id="settings-modal" class="modal" hidden>
    <div class="modal__backdrop" data-close="settings"></div>
    <div class="modal__body" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="modal__head">
        <h2 id="settings-title" class="modal__title">Настройки</h2>
        <button class="btn-ghost" id="settings-close" data-close="settings" type="button">✕</button>
      </div>
      <div class="modal__content">
        <label class="field">
          <span class="field__label">Провайдер</span>
          <select id="settings-provider" class="input">
            <option value="none">Без модели</option>
            <option value="ollama">Ollama (локально)</option>
            <option value="openai">OpenAI-совместимый API</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Модель</span>
          <input id="settings-model" class="input" placeholder="qwen2.5-coder:7b" />
        </label>
        <label class="field">
          <span class="field__label">Адрес API</span>
          <input id="settings-baseurl" class="input" placeholder="http://localhost:11434" />
        </label>
        <label class="field">
          <span class="field__label">API-ключ</span>
          <input id="settings-apikey" class="input" type="password" placeholder="хранится только в браузере" />
        </label>
        <label class="field">
          <span class="field__label">Тема</span>
          <select id="settings-theme" class="input">
            <option value="dark">Тёмная</option>
            <option value="light">Светлая</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Размер шрифта кода</span>
          <input id="settings-fontsize" class="input" type="number" min="11" max="22" step="1" />
        </label>
      </div>
      <div class="modal__foot">
        <button class="btn-ghost" data-close="settings" type="button">Отмена</button>
        <button class="btn-primary" id="settings-save" type="button">Сохранить</button>
      </div>
    </div>
  </div>

  <div id="palette" class="palette" hidden>
    <div class="palette__backdrop" data-close="palette"></div>
    <div class="palette__body" role="dialog" aria-modal="true">
      <input id="palette-input" class="palette__input" placeholder="Команда или имя файла…" autocomplete="off" />
      <div id="palette-list" class="palette__list"></div>
    </div>
  </div>

  <div id="toasts" class="toasts"></div>

  <script type="module" src="js/app.js"></script>
</body>
</html>
````

4. Замени всё содержимое файла `js/app.js` на текст ниже — инструментом write_file (не edit_file). Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/* Kaitos v0.1.0 — точка входа. Каркас экрана: часы, тема, сворачивание панелей. */

import { $, formatTime } from './dom.js';

const VERSION = '0.1.0';

const ctx = {
  version: VERSION,
  settings: { theme: 'dark' },
};

function setTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  ctx.settings.theme = value;
  try {
    window.localStorage.setItem('kaitos.theme', value);
  } catch (error) {
    /* настройки просто не сохранятся */
  }
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
  let saved = 'dark';
  try {
    saved = window.localStorage.getItem('kaitos.theme') || 'dark';
  } catch (error) {
    saved = 'dark';
  }
  setTheme(saved);

  $('#project-name').textContent = 'demo';
  $('#btn-theme').addEventListener('click', () => {
    setTheme(ctx.settings.theme === 'dark' ? 'light' : 'dark');
  });
  $('#btn-sidebar-toggle').addEventListener('click', toggleSidebar);
  $('#btn-terminal-toggle').addEventListener('click', toggleTerminal);

  startClock();

  ctx.toggleSidebar = toggleSidebar;
  ctx.toggleTerminal = toggleTerminal;
  ctx.ready = true;
  window.Kaitos = ctx;
}

boot();
````

5. Запусти `npm run dev` и открой страницу: должны быть видны надписи Kaitos, «Файлы», «Ассистент», «Терминал», «Отправить».

Готово, когда:
- `index.html` и `js/app.js` есть в корне репозитория.
- Страница открывается, ошибок в консоли браузера нет (кроме отсутствующих css-файлов — они появятся в задаче 3).
- Кнопка «Тема» переключает атрибут `data-theme` у `<html>` с `dark` на `light` и обратно.
- Кнопки ««» (в панели «Файлы») и «⌄» (в панели «Терминал») сворачивают свои панели.
- В строке состояния идут часы.

Не делать:
- Не создавай файлы css/ — это задача 3.
- Не создавай js/dom.js, js/fs.js, js/editor.js и другие модули — они появятся в задачах 4–10.
- Не меняй package.json и justai.app.json.
- Не меняй id элементов и не удаляй блоки разметки.
