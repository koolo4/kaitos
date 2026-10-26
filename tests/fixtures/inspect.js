/* Команды для кроссплатформенных e2e-проверок терминала на реальном проекте. */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [action, target] = process.argv.slice(2);
if (action === 'ls') {
  for (const name of readdirSync('.').sort()) {
    const suffix = statSync(name).isDirectory() ? '/' : '';
    console.log(`${name}${suffix}`);
  }
} else if (action === 'cat' && target) {
  process.stdout.write(readFileSync(resolve(target), 'utf8'));
} else {
  console.error('использование: inspect.js ls | cat <путь>');
  process.exitCode = 2;
}
