import { reporter } from './reporter.mjs';
import { createActivityLog, ACTIVITY_LIMITS } from '../js/activity-log.js';

const { check, result } = reporter('Журнал действий');

const data = new Map();
const storage = {
  getItem: (key) => data.get(key) || null,
  setItem: (key, value) => data.set(key, value),
};
let clock = 1_800_000_000_000;
const log = createActivityLog({ root: '/project-a', storage, now: () => clock });

await check('фактические события сохраняются и читаются новыми сверху', () => {
  log.record('file-change', 'Изменён src/app.js');
  clock += 1000;
  log.record('verification', 'npm test: успешно');
  const events = log.list();
  if (events.length !== 2 || events[0].type !== 'verification') throw new Error(JSON.stringify(events));
  if (!data.has(log.key)) throw new Error('журнал не сохранён в storage');
  return `${events.length} события`;
});

await check('отчёт за период содержит сводку и не включает предыдущие события', () => {
  clock += 120_000;
  log.record('web-search', 'Поиск: 3 источника');
  const report = log.createReport({ periodMs: 60_000, at: clock });
  if (!report.summary.includes('Событий: 1') || !report.summary.includes('web-search: 1')) throw new Error(report.summary);
  clock += 100;
  log.record('plan-approved', 'Подтверждён план');
  return report.summary.split('\n')[0];
});

await check('периодический отчёт создаётся один раз в сутки при наличии действий', () => {
  let next = clock + ACTIVITY_LIMITS.DAY_MS + 1;
  const report = log.maybeCreatePeriodicReport(next);
  if (!report || report.type !== 'periodic-report') throw new Error('отчёт не создан');
  if (log.maybeCreatePeriodicReport(next + 1000)) throw new Error('повторный отчёт создан сразу');
  return report.type;
});

await check('состояние журнала переживает повторную инициализацию', () => {
  const restored = createActivityLog({ root: '/project-a', storage, now: () => clock });
  if (restored.list().length !== log.list().length) throw new Error('события потерялись после reload');
  return `${restored.list().length} событий`;
});

process.exit(result() ? 1 : 0);
