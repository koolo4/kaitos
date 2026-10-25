/* Запускает все наборы тестов из tests/*.mjs (кроме harness.mjs) и возвращает общий код выхода. */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITES = readdirSync(HERE)
  .filter((file) => file.endsWith('.mjs') && file !== 'run.mjs' && file !== 'harness.mjs')
  .sort();

const failed = [];
const passed = [];

for (const suite of SUITES) {
  console.log(`\n>>> ${suite}`);
  const run = spawnSync(process.execPath, [join(HERE, suite)], { stdio: 'inherit' });
  if (run.status === 0) passed.push(suite);
  else failed.push(suite);
}

// Итог в конце: в логах внешних проверок видно только хвост вывода.
console.log('');
if (failed.length) {
  console.log(`ПРОВАЛЕНО НАБОРОВ: ${failed.length} из ${SUITES.length} — ${failed.join(', ')}`);
  console.log(`Прошли: ${passed.join(', ') || 'ничего'}`);
} else {
  console.log(`ВСЕ ТЕСТЫ ПРОШЛИ (${SUITES.length} наборов)`);
}
process.exit(failed.length ? 1 : 0);
