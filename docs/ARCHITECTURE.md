# Архитектура Kaitos

Kaitos — AI-редактор кода в браузере (аналог Cursor / Claude Code). Один экран:
панель файлов, редактор с вкладками, чат с ассистентом, терминал, строка состояния, палитра команд.

## Слои

```
index.html            статическая разметка всех панелей и модалок (id — публичный контракт)
css/base.css          переменные тем, каркас экрана, кнопки, статусная строка, адаптивность
css/components.css    дерево, вкладки, редактор, терминал, чат, модалки, палитра, тосты
js/app.js             точка входа: создаёт ctx, вызывает init* модулей, связывает их
js/dom.js             помощники: $, $$, el, escapeHtml, debounce, formatTime, toast
js/fs.js              виртуальная файловая система демо-проекта (в памяти)
js/editor.js          редактор: вкладки, нумерация строк, черновики, сохранение по Ctrl+S
js/tree.js            дерево файлов из ctx.fs.tree(), сворачивание папок
js/chat.js            панель ассистента (сейчас демо-ответы без сети)
js/terminal.js        виртуальный терминал: ls, cat, open, theme, model и др.
js/settings.js        настройки в localStorage: провайдер, модель, ключ, тема, шрифт
js/palette.js         палитра команд (Ctrl+K) и быстрый переход к файлам
js/llm.js             клиент моделей: Ollama и OpenAI-совместимые API, поток, отмена, проверка связи
js/prompts.js         системный промпт, сборка контекста (файл, выделение, история)
js/markdown.js        безопасный мини-markdown для ответов (код, списки, экранирование)
tests/e2e/*.yml       постоянные сценарии проверки интерфейса
tests/*.mjs           сквозные тесты в jsdom (интерфейс и клиент модели), запуск: npm test
```

## Общий объект ctx

`js/app.js` создаёт единственный объект `ctx` и передаёт его в каждый `init*`:

| Поле | Что это |
|---|---|
| `ctx.fs` | файловая система: `read`, `write`, `has`, `create`, `remove`, `list`, `listDir`, `tree`, `size` |
| `ctx.editor` | `open(path)`, `close(path)`, `save()`, `onChange(fn)`, `contentOf(path)`, `active`, `tabs` |
| `ctx.tree` | `render()`, `setActive(path)` |
| `ctx.chat` | `send(text)`, `clear()`, `messages` |
| `ctx.terminal` | `run(line)`, `clear()`, `print(text, kind)` |
| `ctx.settings` | текущие настройки (объект) |
| `ctx.settingsApi` | `open()`, `close()`, `save()` — модалка настроек |
| `ctx.palette` | `open()`, `close()` |
| `ctx.llm` | `chat({ messages, onToken, signal })`, `test()`, `setMock(fn)`, `clearMock()`, `isConfigured()` |
| `ctx.updateSettings(patch)` | изменить настройки, сохранить и применить |
| `ctx.toggleSidebar()`, `ctx.toggleTerminal()` | свернуть панели |

`window.Kaitos = ctx` — через это e2e-сценарии и консоль браузера обращаются к приложению.

## Контракт разметки

Идентификаторы из `index.html` менять нельзя — на них опираются тесты и модули:
`#app`, `#titlebar`, `#project-name`, `#model-chip`, `#btn-palette`, `#btn-theme`, `#btn-settings`,
`#sidebar`, `#file-tree`, `#btn-sidebar-toggle`, `#main-area`, `#tabs`, `#editor`, `#line-numbers`,
`#editor-input`, `#editor-empty`, `#terminal`, `#terminal-output`, `#terminal-input`, `#terminal-form`,
`#btn-terminal-clear`, `#btn-terminal-toggle`, `#chat`, `#chat-messages`, `#chat-context`,
`#chat-quick`, `#chat-form`, `#chat-input`, `#chat-send`, `#statusbar`, `#status-file`,
`#status-position`, `#status-dirty`, `#status-model`, `#status-clock`, `#settings-modal`,
`#settings-*`, `#palette`, `#palette-input`, `#palette-list`, `#toasts`.

## Фаза 2: нейросеть (сделано)

1. `js/llm.js` — провайдеры `ollama` (`/api/chat`, NDJSON) и `openai` (`/v1/chat/completions`, SSE),
   потоковая отдача токенов в `onToken`, отмена через `AbortSignal`, понятные ошибки
   (`network`, `http`, `no-provider`, `aborted`), проверка соединения `test()`.
2. `js/prompts.js` — системный промпт, контекст файла с обрезкой до 12 000 символов, история из 12 сообщений.
3. `js/chat.js` — настоящие ответы модели, потоковая отрисовка, кнопка «Остановить», ошибки с подсказками,
   демо-режим без модели.
4. `js/markdown.js` — блоки кода с копированием, списки, заголовки; весь текст экранируется.
5. `js/settings.js` — температура, предел токенов, «Проверить соединение».

### Что осталось на следующую фазу

1. Подсветка синтаксиса в редакторе (сейчас — обычный `textarea` с моноширинным шрифтом).
2. Инструменты агента: модель предлагает правку файла, интерфейс показывает diff и применяет его к `ctx.fs`.
3. Локальный сервер (Node) для настоящих файлов на диске, запуска команд и git — браузер сам этого не может.
4. Хранение ключей вне браузера, если приложение станет публичным.

### Как подключить модель

- **Ollama локально:** установить, `ollama pull qwen2.5-coder:7b`, запустить с `OLLAMA_ORIGINS=*`,
  в настройках выбрать «Ollama», модель `qwen2.5-coder:7b`, адрес `http://localhost:11434`.
- **OpenAI-совместимый API:** адрес (например `https://api.openai.com` или свой сервер), модель, ключ.
  Ключ хранится только в localStorage браузера.
- Кнопка «Проверить соединение» в настройках показывает доступные модели или текст ошибки.
