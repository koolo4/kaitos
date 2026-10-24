/* Дерево файлов в левой панели: папки сворачиваются, файлы открываются в редакторе. */

import { $ } from './dom.js';

export function initTree(ctx) {
  const root = $('#file-tree');
  const collapsed = new Set();

  function setActive(path) {
    root.querySelectorAll('.tree-row').forEach((row) => {
      row.classList.toggle('is-active', Boolean(path) && row.dataset.path === path);
    });
  }

  function renderNode(node, depth) {
    const row = document.createElement('div');
    row.className = 'tree-row' + (node.type === 'dir' ? ' tree-row--dir' : '');
    row.dataset.path = node.path;
    row.dataset.type = node.type;
    row.style.setProperty('--depth', String(depth));
    row.setAttribute('role', 'treeitem');

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    if (node.type === 'dir') icon.textContent = collapsed.has(node.path) ? '▸' : '▾';
    else icon.textContent = '·';

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node.name;

    row.append(icon, name);

    row.addEventListener('click', () => {
      if (node.type === 'dir') {
        if (collapsed.has(node.path)) collapsed.delete(node.path);
        else collapsed.add(node.path);
        render();
        return;
      }
      if (ctx.editor) ctx.editor.open(node.path);
    });

    const wrap = document.createElement('div');
    wrap.append(row);

    if (node.type === 'dir' && !collapsed.has(node.path)) {
      for (const child of node.children || []) wrap.append(renderNode(child, depth + 1));
    }
    return wrap;
  }

  function render() {
    root.innerHTML = '';
    const nodes = ctx.fs.tree();
    if (!nodes.length) {
      root.textContent = 'В проекте нет файлов';
      return;
    }
    for (const node of nodes) root.append(renderNode(node, 0));
    setActive(ctx.editor ? ctx.editor.active : null);
  }

  render();
  if (ctx.editor) ctx.editor.onChange((info) => setActive(info.path));

  return { render, setActive };
}
