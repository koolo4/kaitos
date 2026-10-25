/* Запускает все наборы тестов из tests/*.mjs (кроме harness.mjs) и возвращает общий код выхода. */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/* --only-errors: печатать только провалившиеся проверки (для внешних логов, где виден лишь хвост). */
const ONLY_ERRORS = process.argv.includes('--only-errors');
const SUITES = readdirSync(HERE)
  .filter((file) => file.endsWith('.mjs') && file !== 'run.mjs' && file !== 'harness.mjs')
  .sort();

const failed = [];
const passed = [];

for (const suite of SUITES) {
  if (!ONLY_ERRORS) console.log(`\n>>> ${suite}`);
  const run = spawnSync(process.execPath, [join(HERE, suite)], {
    stdio: ONLY_ERRORS ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (run.status === 0) {
    passed.push(suite);
  } else {
    failed.push(suite);
    if (ONLY_ERRORS) {
      const lines = `${run.stdout || ''}${run.stderr || ''}`.split('\n');
      const errors = lines.filter((line) => /^✗|ошибк|Error|error|провалено/.test(line));
      console.log(`\n✗ ${suite}`);
      for (const line of errors.slice(0, 12)) console.log(`   ${line}`);
      if (!errors.length) console.log(`   код выхода ${run.status}`);
    }
  }
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
