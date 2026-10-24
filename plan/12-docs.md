Цель: Добавить третий сценарий проверки (палитра команд) и документ об архитектуре проекта, чтобы следующие фазы (нейросеть, инструменты агента) шли по понятному плану.

Проект: Kaitos — AI-редактор кода в браузере (аналог Cursor / Claude Code).
Стек: Vite 5 + ванильный JavaScript, ES-модули. Все файлы — в корне репозитория.
Разметка приложения живёт в index.html, стили — в css/, код — в js/. Какие файлы создать или заменить, сказано в требованиях.

Требования:

1. Создай файл `tests/e2e/palette.yml` с текстом ниже — инструментом write_file. Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
name: Палитра команд
steps:
  - click: '#btn-palette'
  - expectVisible: '#palette'
  - type: { selector: '#palette-input', text: 'README' }
  - expectCount: { selector: '.palette__item', min: 1 }
  - screenshot: { name: palette, width: 1280 }
  - click: '.palette__item'
  - expectHidden: '#palette'
  - expectText: { selector: '#status-file', contains: 'README.md' }
  - expectVisible: '#editor-input'
  - click: '#btn-palette'
  - expectVisible: '#palette'
  - type: { selector: '#palette-input', text: 'тему' }
  - expectCount: { selector: '.palette__item', min: 1 }
  - screenshot: { name: palette, width: 375 }
  - press: Escape
  - expectHidden: '#palette'
  - expectNoConsoleErrors:
````

2. Создай файл `docs/ARCHITECTURE.md` с текстом ниже — инструментом write_file. Пиши весь текст целиком, ничего не сокращая, не пересказывая и не добавляя от себя.

````
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
tests/e2e/*.yml       постоянные сценарии проверки интерфейса
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

## Фаза 2: нейросеть

Планируется отдельными задачами:

1. `js/llm.js` — клиент провайдеров: Ollama (`/api/chat`) и OpenAI-совместимый (`/v1/chat/completions`),
   потоковые ответы, отмена запроса, обработка ошибок сети.
2. Замена демо-ответов в `js/chat.js` на настоящий вызов модели с контекстом: открытый файл,
   выделение, история чата, системный промпт.
3. Подсветка синтаксиса в редакторе (отдельный слой поверх `textarea`).
4. Инструменты агента: предложение правок файлов, предпросмотр diff, применение правки к `ctx.fs`.
5. Для настоящих файлов на диске и запуска команд понадобится локальный сервер
   (Node + HTTP API) — браузер сам файлы читать не может.
````

3. Прогони `/justai e2e #N all` — все три сценария должны пройти.

Готово, когда:
- Файлы `tests/e2e/palette.yml` и `docs/ARCHITECTURE.md` есть в репозитории.
- `/justai e2e #N all` проходит: shell, workspace, palette — все PASS.
- Документ перечисляет модули, поля `ctx`, контракт id и план фазы 2.

Не делать:
- Не меняй код приложения и не правь index.html.
- Не удаляй существующие файлы и сценарии.
