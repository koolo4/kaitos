/*
 * Виртуальная файловая система Kaitos.
 * Демо-проект живёт в памяти браузера: файлы можно читать, править, создавать и удалять.
 * Позже этот модуль заменится вызовами к локальному серверу — интерфейс останется тем же.
 */

export const PROJECT_NAME = 'demo';

export const SEED_FILES = {
  'README.md': '# Демо-проект Kaitos\n\nЭтот проект живёт в памяти браузера: файлы можно\nоткрывать, править и сохранять (Ctrl+S).\n\nПодключение настоящей нейросети — следующая фаза.\n',
  'package.json': '{\n  "name": "kaitos-demo",\n  "version": "0.1.0",\n  "type": "module",\n  "scripts": {\n    "start": "node src/main.js"\n  }\n}\n',
  'src/main.js': "import { greet } from './utils.js';\n\nexport function start(name = 'мир') {\n  const message = greet(name);\n  console.log(message);\n  return message;\n}\n\nstart();\n",
  'src/utils.js': "export function greet(name) {\n  return `Привет, ${name}!`;\n}\n\nexport function sum(numbers) {\n  return numbers.reduce((total, n) => total + n, 0);\n}\n",
  'src/components/button.js': "export function createButton(label, onClick) {\n  const button = document.createElement('button');\n  button.textContent = label;\n  button.addEventListener('click', onClick);\n  return button;\n}\n",
  'src/components/chat.js': "export function createMessage(role, text) {\n  return {\n    role,\n    text,\n    time: new Date().toISOString(),\n  };\n}\n",
  'styles/theme.css': ':root {\n  --bg: #14161b;\n  --text: #e6e8ee;\n}\n\nbody {\n  background: var(--bg);\n  color: var(--text);\n}\n',
  'docs/notes.md': '# Заметки\n\n- [x] каркас экрана\n- [ ] подключить нейросеть\n- [ ] инструменты агента\n',
};

function normalize(path) {
  return String(path ?? '')
    .trim()
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '');
}

export function createFs(initial = SEED_FILES) {
  const files = new Map(Object.entries(initial).map(([path, text]) => [normalize(path), text]));

  function has(path) {
    return files.has(normalize(path));
  }

  function read(path) {
    const key = normalize(path);
    if (!files.has(key)) throw new Error(`Файл не найден: ${key}`);
    return files.get(key);
  }

  function write(path, text) {
    files.set(normalize(path), String(text ?? ''));
    return normalize(path);
  }

  function create(path, text = '') {
    const key = normalize(path);
    if (!key) throw new Error('Пустой путь');
    if (files.has(key)) throw new Error(`Файл уже существует: ${key}`);
    files.set(key, String(text));
    return key;
  }

  function remove(path) {
    files.delete(normalize(path));
  }

  function list() {
    return Array.from(files.keys()).sort((a, b) => a.localeCompare(b));
  }

  /* Заменяет всё содержимое (используется при загрузке проекта с сервера). */
  function load(source = {}) {
    files.clear();
    const entries = Array.isArray(source) ? source : Object.entries(source || {});
    for (const entry of entries) {
      if (Array.isArray(entry)) files.set(normalize(entry[0]), String(entry[1] ?? ''));
    }
    return files.size;
  }

  function listDir(dir = '') {
    const base = normalize(dir);
    const prefix = base ? `${base}/` : '';
    const seen = new Map();
    for (const path of list()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const [name, ...tail] = rest.split('/');
      const isDir = tail.length > 0;
      if (!seen.has(name) || !isDir) seen.set(name, { name, type: isDir ? 'dir' : 'file' });
    }
    return Array.from(seen.values()).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  function sortTree(node) {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortTree);
  }

  function tree() {
    const root = { name: PROJECT_NAME, path: '', type: 'dir', children: [] };
    for (const path of list()) {
      const parts = path.split('/');
      let node = root;
      for (let i = 0; i < parts.length; i += 1) {
        const name = parts[i];
        const isFile = i === parts.length - 1;
        const childPath = parts.slice(0, i + 1).join('/');
        let child = node.children.find((item) => item.name === name);
        if (!child) {
          child = isFile
            ? { name, path: childPath, type: 'file' }
            : { name, path: childPath, type: 'dir', children: [] };
          node.children.push(child);
        }
        if (isFile) break;
        node = child;
      }
    }
    sortTree(root);
    return root.children;
  }

  return {
    name: () => PROJECT_NAME,
    has,
    read,
    write,
    create,
    remove,
    load,
    list,
    listDir,
    tree,
    normalize,
    size: () => files.size,
  };
}
