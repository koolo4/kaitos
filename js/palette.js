/* Палитра команд (Ctrl+K): команды приложения и быстрый переход к файлам. */

import { $ } from './dom.js';

export function initPalette(ctx) {
  const root = $('#palette');
  const inputEl = $('#palette-input');
  const listEl = $('#palette-list');
  let items = [];
  let selected = 0;

  function buildCommands() {
    const commands = [
      { group: 'Приложение', title: 'Настройки', run: () => ctx.settingsApi.open() },
      {
        group: 'Приложение',
        title: 'Переключить тему',
        run: () => ctx.updateSettings({ theme: ctx.settings.theme === 'dark' ? 'light' : 'dark' }),
      },
      { group: 'Приложение', title: 'Очистить чат', run: () => ctx.chat.clear() },
      { group: 'Терминал', title: 'Очистить терминал', run: () => ctx.terminal.clear() },
      { group: 'Терминал', title: 'Свернуть или развернуть терминал', run: () => ctx.toggleTerminal() },
      { group: 'Терминал', title: 'Перейти в терминал', run: () => $('#terminal-input').focus() },
      { group: 'Панели', title: 'Свернуть или развернуть дерево файлов', run: () => ctx.toggleSidebar() },
    ];
    for (const path of ctx.fs.list()) {
      commands.push({ group: 'Файлы', title: `Открыть ${path}`, run: () => ctx.editor.open(path) });
    }
    return commands;
  }

  function render(filter = '') {
    const query = filter.trim().toLowerCase();
    const all = buildCommands();
    items = query ? all.filter((item) => item.title.toLowerCase().includes(query)) : all;
    if (selected > items.length - 1) selected = Math.max(0, items.length - 1);

    listEl.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'palette__empty';
      empty.textContent = 'Ничего не найдено';
      listEl.append(empty);
      return;
    }

    let lastGroup = null;
    items.forEach((item, index) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        const group = document.createElement('div');
        group.className = 'palette__group';
        group.textContent = item.group;
        listEl.append(group);
      }

      const row = document.createElement('div');
      row.className = 'palette__item' + (index === selected ? ' is-selected' : '');
      row.dataset.index = String(index);
      row.textContent = item.title;
      listEl.append(row);
    });

    const active = listEl.querySelector('.palette__item.is-selected');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function choose(index) {
    const item = items[index];
    if (!item) return;
    close();
    item.run();
  }

  function open() {
    root.hidden = false;
    inputEl.value = '';
    selected = 0;
    render('');
    inputEl.focus();
  }

  function close() {
    root.hidden = true;
  }

  document.addEventListener('keydown', (event) => {
    const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (isShortcut) {
      event.preventDefault();
      if (root.hidden) open();
      else close();
      return;
    }
    if (root.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selected = Math.min(items.length - 1, selected + 1);
      render(inputEl.value);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selected = Math.max(0, selected - 1);
      render(inputEl.value);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(selected);
    }
  });

  inputEl.addEventListener('input', () => {
    selected = 0;
    render(inputEl.value);
  });

  listEl.addEventListener('click', (event) => {
    const row = event.target.closest('[data-index]');
    if (row) choose(Number(row.dataset.index));
  });

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close="palette"]')) close();
  });

  return { open, close };
}
