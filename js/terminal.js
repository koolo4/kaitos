/*
 * Встроенный терминал.
 *
 * С локальным сервером команды выполняются по-настоящему в папке проекта (/api/run).
 * Без сервера работает виртуальный набор команд над демо-проектом.
 */

import { $ } from './dom.js';

export function initTerminal(ctx) {
  const output = $('#terminal-output');
  const form = $('#terminal-form');
  const input = $('#terminal-input');
  const stopButton = $('#terminal-stop');
  const history = [];
  let activeRun = null;
  let historyIndex = 0;

  function print(text, kind = '') {
    const line = document.createElement('div');
    line.className = 'term-line' + (kind ? ` term-line--${kind}` : '');
    line.textContent = text;
    output.append(line);
    output.scrollTop = output.scrollHeight;
  }

  function clear() {
    output.innerHTML = '';
  }

  const commands = {
    help() {
      print('Команды: help, ls [папка], cat <файл>, open <файл>, pwd, echo <текст>, date, theme dark|light, model, clear, whoami', 'muted');
    },
    ls(args) {
      const dir = args[0] || '';
      const items = ctx.fs.listDir(dir);
      if (!items.length) {
        print(`пусто: ${dir || '/'}`);
        return;
      }
      print(items.map((item) => (item.type === 'dir' ? `${item.name}/` : item.name)).join('  '));
    },
    cat(args) {
      if (!args[0]) {
        print('использование: cat <путь>', 'err');
        return;
      }
      try {
        print(ctx.fs.read(args[0]));
      } catch (error) {
        print(error.message, 'err');
      }
    },
    open(args) {
      if (!args[0]) {
        print('использование: open <путь>', 'err');
        return;
      }
      if (!ctx.fs.has(args[0])) {
        print(`Файл не найден: ${args[0]}`, 'err');
        return;
      }
      ctx.editor.open(args[0]);
      print(`открыт ${args[0]}`, 'ok');
    },
    pwd() {
      print('/home/user/demo');
    },
    echo(args) {
      print(args.join(' '));
    },
    date() {
      print(new Date().toLocaleString('ru-RU'));
    },
    theme(args) {
      const value = args[0];
      if (value !== 'dark' && value !== 'light') {
        print('использование: theme dark|light', 'err');
        return;
      }
      ctx.updateSettings({ theme: value });
      print(`тема: ${value}`, 'ok');
    },
    model() {
      print(`провайдер: ${ctx.settings.provider}, модель: ${ctx.settings.model || '—'}`);
    },
    whoami() {
      print('kaitos');
    },
    clear() {
      clear();
    },
  };

  function realMode() {
    return Boolean(ctx.api && ctx.api.git && ctx.storage && ctx.storage.mode === 'disk');
  }

  function prompt() {
    return realMode() ? `${(ctx.storage && ctx.storage.name) || 'проект'} $` : 'kaitos:~/demo $';
  }

  async function runReal(value) {
    if (value === 'clear') {
      clear();
      return;
    }
    if (value === 'help') {
      print('Терминал выполняет настоящие команды в папке проекта (sh или cmd). Во время команды можно нажать «Остановить». Ctrl+L — очистить.', 'muted');
      return;
    }
    print(`${prompt()} ${value}`, 'cmd');
    print('выполняю…', 'muted');
    const controller = new AbortController();
    activeRun = controller;
    stopButton.hidden = false;
    input.disabled = true;
    try {
      const result = await ctx.api.run(value, controller.signal);
      output.lastElementChild?.remove(); // убираем «выполняю…»
      const text = (result.output || '').replace(/\n$/, '');
      if (text) {
        for (const line of text.split('\n')) print(line);
      }
      if (result.cancelled) print('команда остановлена', 'warn');
      else if (result.timedOut) print('остановлено по таймауту (60 с)', 'err');
      else if (result.code) print(`код выхода: ${result.code}`, 'err');
      else print(`готово за ${result.durationMs} мс`, 'ok');
      if (result.truncated) print('вывод обрезан', 'muted');
      if (ctx.git) ctx.git.refresh();
    } catch (error) {
      output.lastElementChild?.remove();
      if (controller.signal.aborted) print('команда остановлена', 'warn');
      else print(`команда не выполнилась: ${error.message}`, 'err');
    } finally {
      if (activeRun === controller) activeRun = null;
      stopButton.hidden = true;
      stopButton.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  function run(line) {
    const value = String(line || '').trim();
    if (realMode()) return runReal(value);
    print(`kaitos:~/demo $ ${value}`, 'cmd');
    if (!value) return;
    history.push(value);
    historyIndex = history.length;
    const parts = value.split(/\s+/);
    const name = parts[0];
    const args = parts.slice(1);
    const command = commands[name];
    if (!command) {
      print(`команда не найдена: ${name}. Введите help.`, 'err');
      return;
    }
    try {
      command(args);
    } catch (error) {
      print(error.message, 'err');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (activeRun) return;
    run(input.value);
    input.value = '';
  });

  stopButton.addEventListener('click', () => {
    if (activeRun) stopButton.disabled = true;
    activeRun?.abort();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'l' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      clear();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] || '';
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] || '';
    }
  });

  print('Kaitos v0.1.0 — виртуальный терминал демо-проекта. Введите help.', 'muted');

  return { run, clear, print, get real() { return realMode(); } };
}
