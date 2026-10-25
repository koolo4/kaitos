/* Встроенный терминал: виртуальные команды над демо-проектом, история по стрелкам. */

import { $ } from './dom.js';

export function initTerminal(ctx) {
  const output = $('#terminal-output');
  const form = $('#terminal-form');
  const input = $('#terminal-input');
  const history = [];
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

  function run(line) {
    const value = String(line || '').trim();
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
    run(input.value);
    input.value = '';
  });

  input.addEventListener('keydown', (event) => {
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

  return { run, clear, print };
}
