/* Команды для кроссплатформенных e2e-проверок терминала на реальном проекте. */
import { readdirSync, statSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [action, target] = process.argv.slice(2);
if (action === 'ls') {
  for (const name of readdirSync('.').sort()) {
    const suffix = statSync(name).isDirectory() ? '/' : '';
    console.log(`${name}${suffix}`);
  }
} else if (action === 'cat' && target) {
  process.stdout.write(readFileSync(resolve(target), 'utf8'));
} else if (action === 'branch-create' && target) {
  try {
    execFileSync('git', ['branch', target], { stdio: 'ignore' });
  } catch (error) {
    if (!execFileSync('git', ['branch', '--list', target], { encoding: 'utf8' }).trim()) throw error;
  }
} else if (action === 'branch-delete' && target) {
  try {
    execFileSync('git', ['branch', '-D', target], { stdio: 'ignore' });
  } catch (error) {
    // Повторный e2e может завершиться до очистки; отсутствующая ветка уже чистое состояние.
    if (execFileSync('git', ['branch', '--list', target], { encoding: 'utf8' }).trim()) throw error;
  }
} else if (action === 'file-delete' && target) {
  rmSync(resolve(target), { force: true });
} else {
  console.error('использование: inspect.js ls | cat <путь>');
  process.exitCode = 2;
}
