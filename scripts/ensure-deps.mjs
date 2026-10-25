/*
 * Перед тестами проверяет, что зависимости установлены.
 * Нужно для чистых рабочих копий (ПК1, CI): `npm test` запускается в папке без node_modules,
 * а тестам нужны jsdom и esbuild.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const required = ['jsdom', 'esbuild'];

const missing = required.filter((name) => !existsSync(join(ROOT, 'node_modules', name)));
if (!missing.length) process.exit(0);

console.log(`[ensure-deps] не хватает: ${missing.join(', ')} — устанавливаю зависимости…`);
const hasLock = existsSync(join(ROOT, 'package-lock.json'));
const args = hasLock ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund'];
const result = spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });

if (result.status !== 0) {
  console.error('[ensure-deps] установить зависимости не удалось — запустите npm install вручную');
  process.exit(result.status || 1);
}

const stillMissing = required.filter((name) => !existsSync(join(ROOT, 'node_modules', name)));
if (stillMissing.length) {
  console.error(`[ensure-deps] после установки всё ещё нет: ${stillMissing.join(', ')}`);
  process.exit(1);
}

console.log('[ensure-deps] готово');
