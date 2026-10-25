/*
 * Отчёт о проверках и пауза — без jsdom и esbuild.
 *
 * Наборы, которым не нужен браузер (сервер, слежение на уровне node), импортируют этот файл,
 * чтобы не поднимать лишние нативные зависимости: на Windows они иногда роняют процесс при выходе.
 */

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function reporter(title) {
  const state = { failed: 0, passed: 0 };
  console.log(`\n=== ${title} ===`);
  return {
    async check(name, fn) {
      try {
        const value = await fn();
        if (value === false) throw new Error('вернуло false');
        state.passed += 1;
        console.log('✓', name, value === true || value === undefined ? '' : `→ ${JSON.stringify(value).slice(0, 110)}`);
      } catch (error) {
        state.failed += 1;
        console.log('✗', name, '—', error.message);
      }
    },
    result() {
      console.log(`--- ${title}: ${state.passed} прошло, ${state.failed} провалено`);
      return state.failed;
    },
  };
}
