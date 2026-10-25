/* Запускает все наборы тестов из tests/*.mjs (кроме harness.mjs) и возвращает общий код выхода. */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITES = readdirSync(HERE)
  .filter((file) => file.endsWith('.mjs') && file !== 'run.mjs' && file !== 'harness.mjs')
  .sort();

let failed = 0;
for (const suite of SUITES) {
  console.log(`\n>>> ${suite}`);
  const run = spawnSync(process.execPath, [join(HERE, suite)], { stdio: 'inherit' });
  if (run.status !== 0) failed += 1;
}

console.log(failed ? `\nПРОВАЛЕНО НАБОРОВ: ${failed} из ${SUITES.length}` : `\nВСЕ ТЕСТЫ ПРОШЛИ (${SUITES.length} наборов)`);
process.exit(failed ? 1 : 0);
