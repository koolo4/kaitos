/* Запускает все наборы тестов по очереди и возвращает общий код выхода. */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITES = ['smoke.mjs', 'llm.mjs'];

let failed = 0;
for (const suite of SUITES) {
  const run = spawnSync(process.execPath, [join(HERE, suite)], { stdio: 'inherit' });
  if (run.status !== 0) failed += 1;
}

console.log(failed ? `\nПРОВАЛЕНО НАБОРОВ: ${failed}` : '\nВСЕ ТЕСТЫ ПРОШЛИ');
process.exit(failed ? 1 : 0);
