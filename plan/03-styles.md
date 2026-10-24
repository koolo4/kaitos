Цель: Оформить экран как тёмную IDE: три колонки, аккуратные панели, вкладки, редактор, чат, терминал, модальное окно, палитра команд. Вторая тема — светлая.

Проект: Kaitos — AI-редактор кода в браузере (аналог Cursor / Claude Code).
Стек: Vite 5 + ванильный JavaScript, ES-модули. Все файлы — в корне репозитория.
Разметка приложения живёт в index.html, стили — в css/, код — в js/. Какие файлы создать или заменить, сказано в требованиях.

Требования:

1. Оба файла уже подключены в `index.html` — менять разметку не нужно.
2. Создай файл `css/base.css` с текстом ниже — инструментом write_file. Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/* Kaitos — основа: переменные тем, сброс, каркас экрана, кнопки, статусная строка, адаптивность. */

:root {
  --bg: #14161b;
  --panel: #1a1d24;
  --panel-2: #20242d;
  --panel-3: #262b36;
  --border: #2a2f3a;
  --text: #e6e8ee;
  --muted: #8b93a7;
  --accent: #6f8cff;
  --accent-soft: rgba(111, 140, 255, 0.16);
  --ok: #3fb950;
  --warn: #d29922;
  --err: #f85149;
  --radius: 10px;
  --radius-sm: 6px;
  --font-ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-code: ui-monospace, "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  --code-size: 13px;
  --sidebar-w: 250px;
  --chat-w: 380px;
  --line-h: 20px;
}

[data-theme="light"] {
  --bg: #f4f6fb;
  --panel: #ffffff;
  --panel-2: #eef1f7;
  --panel-3: #e3e8f2;
  --border: #d9dfea;
  --text: #1b1f27;
  --muted: #5b6474;
  --accent: #3b5bfd;
  --accent-soft: rgba(59, 91, 253, 0.12);
  --ok: #1a7f37;
  --warn: #9a6700;
  --err: #cf222e;
}

* { box-sizing: border-box; }

html, body { margin: 0; height: 100%; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.45;
  overflow: hidden;
}

button { font-family: inherit; font-size: inherit; color: inherit; cursor: pointer; }
input, select, textarea { font-family: inherit; font-size: inherit; color: inherit; }

.muted { color: var(--muted); }
.small { font-size: 12px; }

#app {
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr) 26px;
  height: 100vh;
}

#app.sidebar-collapsed { --sidebar-w: 0px; }

#titlebar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 14px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.titlebar__left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.titlebar__nav { display: flex; align-items: center; gap: 4px; }
.titlebar__right { display: flex; align-items: center; gap: 10px; margin-left: auto; min-width: 0; }

.logo { color: var(--accent); font-size: 18px; }
.logo-text { font-weight: 650; letter-spacing: 0.3px; }

.badge {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  font-size: 11px;
}

.chip {
  display: inline-flex;
  align-items: center;
  max-width: 220px;
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip-sm { font-size: 11px; padding: 2px 8px; }

.chip-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
}

.chip-btn:hover { color: var(--text); border-color: var(--accent); }

.btn-ghost {
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
}

.btn-ghost:hover { background: var(--panel-2); color: var(--text); }
.btn-xs { padding: 3px 7px; font-size: 12px; }

.btn-primary {
  padding: 7px 14px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #ffffff;
  font-weight: 600;
}

.btn-primary:hover { filter: brightness(1.08); }

#workbench {
  display: grid;
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr) var(--chat-w);
  min-height: 0;
}

#sidebar, #chat, #main-area { min-height: 0; min-width: 0; }

#sidebar {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--panel);
  border-right: 1px solid var(--border);
}

.sidebar-collapsed #sidebar { display: none; }

.panel-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.panel-actions { display: flex; align-items: center; gap: 2px; }

#main-area {
  display: grid;
  grid-template-rows: minmax(0, 1fr) 220px;
  min-height: 0;
  background: var(--bg);
}

#editor-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.empty {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--muted);
  text-align: center;
}

.empty[hidden] { display: none; }

#statusbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 12px;
  background: var(--panel);
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
}

.status-item { overflow: hidden; text-overflow: ellipsis; }
.status-spacer { flex: 1 1 auto; }

@media (max-width: 1200px) {
  #app { --chat-w: 330px; }
}

@media (max-width: 1000px) {
  #workbench {
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) 280px;
  }
  #sidebar { grid-column: 1; grid-row: 1 / span 2; }
  #main-area { grid-column: 2; grid-row: 1; }
  #chat { grid-column: 2; grid-row: 2; border-left: none; border-top: 1px solid var(--border); }
}

@media (max-width: 700px) {
  #app { --sidebar-w: 0px; }
  #sidebar { display: none; }
  #workbench { grid-template-columns: minmax(0, 1fr); }
  #main-area, #chat { grid-column: 1; }
  .titlebar__right #project-name { display: none; }
  .titlebar__nav .btn-ghost { padding: 5px 7px; }
}
````

3. Создай файл `css/components.css` с текстом ниже — инструментом write_file. Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
/* Kaitos — компоненты: дерево файлов, вкладки и редактор, терминал, чат, модалки, палитра, тосты. */

/* Дерево файлов */

.tree { flex: 1 1 auto; padding: 6px; overflow: auto; }

.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px calc(6px + var(--depth, 0) * 14px);
  border-radius: var(--radius-sm);
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
}

.tree-row:hover { background: var(--panel-2); }
.tree-row.is-active { background: var(--accent-soft); color: var(--accent); }
.tree-row--dir { color: var(--muted); font-weight: 600; }
.tree-icon { flex: 0 0 auto; width: 14px; text-align: center; color: var(--muted); font-size: 11px; }
.tree-name { overflow: hidden; text-overflow: ellipsis; }

/* Вкладки */

.tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  min-height: 38px;
  overflow-x: auto;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: none;
  border-right: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}

.tab:hover { background: var(--panel-2); color: var(--text); }
.tab.is-active { background: var(--bg); color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
.tab__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.tab__close { padding: 0 2px; border: none; background: transparent; color: var(--muted); font-size: 14px; line-height: 1; }
.tab__close:hover { color: var(--err); }

/* Редактор */

.editor {
  display: none;
  flex: 1 1 auto;
  grid-template-columns: 56px minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}

.editor.is-open { display: grid; }

.line-numbers {
  margin: 0;
  padding: 8px 10px 40px 0;
  overflow: hidden;
  background: var(--panel);
  border-right: 1px solid var(--border);
  color: var(--muted);
  font-family: var(--font-code);
  font-size: var(--code-size);
  line-height: var(--line-h);
  white-space: pre;
  text-align: right;
  user-select: none;
}

.editor-input {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 8px 14px 40px 12px;
  overflow: auto;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-code);
  font-size: var(--code-size);
  line-height: var(--line-h);
  tab-size: 2;
  white-space: pre;
}

/* Терминал */

#terminal {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--panel);
  border-top: 1px solid var(--border);
}

#main-area.is-terminal-collapsed { grid-template-rows: minmax(0, 1fr) 38px; }
#main-area.is-terminal-collapsed .terminal-body { display: none; }

.terminal-body { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; }

.terminal-output {
  flex: 1 1 auto;
  padding: 6px 12px;
  overflow: auto;
  font-family: var(--font-code);
  font-size: 12.5px;
  line-height: 18px;
  white-space: pre-wrap;
  word-break: break-word;
}

.term-line--cmd { color: var(--accent); }
.term-line--err { color: var(--err); }
.term-line--ok { color: var(--ok); }
.term-line--muted { color: var(--muted); }

.terminal-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 8px;
  font-family: var(--font-code);
  font-size: 12.5px;
}

.terminal-prompt { color: var(--ok); white-space: nowrap; }

.terminal-input {
  flex: 1 1 auto;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-code);
  font-size: 12.5px;
}

/* Чат */

#chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--panel);
  border-left: 1px solid var(--border);
}

.chat-messages {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow: auto;
}

.chat-msg {
  max-width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel-2);
}

.chat-msg--user { border-color: transparent; background: var(--accent-soft); }
.chat-msg__head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.chat-msg__role { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.chat-msg__time { font-size: 11px; color: var(--muted); }
.chat-msg__text { font-size: 13.5px; white-space: pre-wrap; word-break: break-word; }
.chat-msg--typing .chat-msg__text { color: var(--muted); }

.chat-quick { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 8px; }

.chat-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--border);
}

.chat-input {
  width: 100%;
  min-height: 62px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  resize: vertical;
  background: var(--bg);
}

.chat-input:focus { border-color: var(--accent); }
.chat-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

/* Модальное окно */

.modal { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; }
.modal[hidden] { display: none; }
.modal__backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.55); }

.modal__body {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}

.modal__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.modal__title { margin: 0; font-size: 16px; }
.modal__content { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; overflow: auto; }
.modal__foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }

.field { display: flex; flex-direction: column; gap: 5px; }
.field__label { font-size: 12px; color: var(--muted); }

.input {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  background: var(--bg);
}

.input:focus { border-color: var(--accent); }

/* Палитра команд */

.palette { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; }
.palette[hidden] { display: none; }
.palette__backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); }

.palette__body {
  position: relative;
  width: min(640px, calc(100vw - 32px));
  overflow: hidden;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}

.palette__input {
  width: 100%;
  padding: 13px 16px;
  border: none;
  border-bottom: 1px solid var(--border);
  outline: none;
  background: transparent;
  font-size: 15px;
}

.palette__list { max-height: 320px; padding: 6px; overflow: auto; }
.palette__item { padding: 8px 10px; border-radius: var(--radius-sm); font-size: 13.5px; cursor: pointer; }
.palette__item.is-selected { background: var(--accent-soft); color: var(--accent); }
.palette__group { padding: 8px 10px 4px; color: var(--muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.palette__empty { padding: 14px 10px; color: var(--muted); font-size: 13px; }

/* Уведомления */

.toasts { position: fixed; right: 16px; bottom: 40px; z-index: 70; display: flex; flex-direction: column; gap: 8px; }

.toast {
  padding: 9px 13px;
  background: var(--panel-3);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 13px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3);
}

.toast--ok { border-left-color: var(--ok); }
.toast--err { border-left-color: var(--err); }
````

4. Запусти `npm run dev` и проверь страницу на ширине 1280 px и 375 px.

Готово, когда:
- Страница выглядит как тёмная IDE: верхняя панель, левая панель «Файлы», центр с редактором, справа «Ассистент», внизу терминал, в самом низу строка состояния.
- Кнопка «Тема» переключает оформление на светлое — фон становится светлым, текст тёмным, ничего не «слепнет».
- При ширине 375 px дерево файлов скрыто, чат оказывается под редактором, горизонтальной прокрутки нет.
- В консоли браузера нет ошибок и 404 по css-файлам.

Не делать:
- Не меняй index.html и js/app.js.
- Не добавляй другие css-файлы и не используй внешние CDN-шрифты (сеть может быть недоступна).
- Не переименовывай классы и id.
