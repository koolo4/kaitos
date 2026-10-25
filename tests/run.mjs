/* Запускает все наборы тестов из tests/*.mjs (кроме harness.mjs) и возвращает общий код выхода. */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/* --only-errors: печатать только провалившиеся проверки (для внешних логов, где виден лишь хвост). */
const ONLY_ERRORS = process.argv.includes('--only-errors');
const SUITES = readdirSync(HERE)
  .filter((file) => file.endsWith('.mjs') && !['run.mjs', 'harness.mjs', 'reporter.mjs'].includes(file))
  .sort();

const failed = [];
const passed = [];

const details = [];

for (const suite of SUITES) {
  if (!ONLY_ERRORS) console.log(`\n>>> ${suite}`);
  const run = spawnSync(process.execPath, [join(HERE, suite)], { stdio: 'pipe', encoding: 'utf8' });
  const output = `${run.stdout || ''}${run.stderr || ''}`;

  if (ONLY_ERRORS) {
    for (const line of output.split('\n')) if (/^✗|провалено/.test(line)) console.log(line);
  } else {
    process.stdout.write(output);
  }

  if (run.status === 0) {
    passed.push(suite);
    continue;
  }

  failed.push(suite);
  const errors = output
    .split('\n')
    .filter((line) => /^✗|не установлен|Error|ошибка/i.test(line))
    .slice(0, 12);
  details.push({ suite, errors, code: run.status });
}

// Итог в конце: в логах внешних проверок видно только хвост вывода.
console.log('');
// Повторяем ошибки в конце: во внешних проверках виден только хвост лога.
if (failed.length) {
  for (const item of details) {
    console.log(`✗ ${item.suite} (код ${item.code})`);
    for (const line of item.errors) console.log(`   ${line}`);
    if (!item.errors.length) console.log('   подробностей в выводе нет');
    console.log('');
  }
}
if (failed.length) {
  console.log(`ПРОВАЛЕНО НАБОРОВ: ${failed.length} из ${SUITES.length} — ${failed.join(', ')}`);
  console.log(`Прошли: ${passed.join(', ') || 'ничего'}`);
} else {
  console.log(`ВСЕ ТЕСТЫ ПРОШЛИ (${SUITES.length} наборов)`);
}
process.exit(failed.length ? 1 : 0);
