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
js/tools.js           инструменты агента: разбор правок файлов из ответа модели, защита путей
js/diff.js            построчный diff (LCS), сжатие контекста, HTML-предпросмотр правки
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
| `ctx.editor.refresh(path)` | перечитать файл из файловой системы после правки моделью |
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

## Фаза 3: инструменты агента (сделано)

Модель не просто советует — она предлагает правку файла, а приложение показывает её как diff.

1. **Протокол правки.** В ответе модели блок с языком `kaitos-write` и путём:

   ````text
   ```kaitos-write src/utils.js
   <полное новое содержимое файла>
   ```
   ````

   Протокол описан в системном промпте (`js/prompts.js`, `EDIT_PROTOCOL`).
2. **`js/tools.js`** — разбор блоков, нормализация путей, защита: абсолютные пути, `..` и выход за проект
   отклоняются ещё до применения; такие правки показываются с объяснением и без кнопки «Применить».
3. **`js/diff.js`** — построчный diff через LCS, сжатие неизменённых участков, подсветка добавленных
   и удалённых строк. Весь текст экранируется.
4. **`js/chat.js`** — карточка правки под ответом: путь, статистика `+N −M`, diff, кнопки «Применить»
   и «Отклонить». Применение пишет файл в `ctx.fs`, перечитывает открытый файл в редакторе и обновляет дерево.

### Что осталось на следующую фазу

1. Подсветка синтаксиса в редакторе (сейчас — `textarea` с моноширинным шрифтом).
2. Точечные правки фрагментов (не только файл целиком) с применением по номеру строки.
3. Локальный сервер (Node) для настоящих файлов на диске, запуска команд и git — браузер сам этого не может.
4. Хранение ключей вне браузера, если приложение станет публичным.
