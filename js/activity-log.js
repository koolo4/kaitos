/* Фактический журнал проекта и компактные периодические отчёты, локально в браузере. */

const MAX_EVENTS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

function hashKey(value) {
  let hash = 2166136261;
  for (const char of String(value || 'project')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function clean(value, limit) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, limit);
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const type = clean(event.type, 48);
  const summary = clean(event.summary, 500);
  const at = Number(event.at);
  if (!type || !summary || !Number.isFinite(at)) return null;
  return { id: clean(event.id, 100) || `${Math.floor(at).toString(36)}-${Math.random().toString(36).slice(2, 8)}`, type, summary, at };
}

function summarize(events, from, to) {
  const actions = events.filter((event) => event.type !== 'periodic-report' && event.type !== 'manual-report');
  if (!actions.length) return 'За выбранный период действий не зафиксировано.';
  const counts = new Map();
  for (const event of actions) counts.set(event.type, (counts.get(event.type) || 0) + 1);
  const types = [...counts.entries()].map(([type, count]) => `${type}: ${count}`).join(', ');
  const recent = actions.slice(-5).map((event) => `• ${event.summary}`).join('\n');
  const start = new Date(from).toLocaleString();
  const end = new Date(to).toLocaleString();
  return `Отчёт за период ${start} — ${end}. Событий: ${actions.length} (${types}).\nПоследние действия:\n${recent}`;
}

export function createActivityLog({ root = '', name = 'project', storage = null, now = Date.now } = {}) {
  const identity = String(root || name || 'project');
  const key = `kaitos.activity.v1.${hashKey(identity)}`;
  let backend = storage;
  try { if (!backend) backend = globalThis.localStorage; } catch (error) { backend = null; }
  const listeners = new Set();
  let state;

  function fresh() {
    return { version: 1, createdAt: now(), lastReportAt: 0, events: [] };
  }

  function normalize(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const createdAt = Number(source.createdAt) || now();
    return {
      version: 1,
      createdAt,
      lastReportAt: Math.max(0, Number(source.lastReportAt) || 0),
      events: (Array.isArray(source.events) ? source.events : []).map(normalizeEvent).filter(Boolean).slice(-MAX_EVENTS),
    };
  }

  function persist() {
    try { backend?.setItem(key, JSON.stringify(state)); } catch (error) { /* журнал остаётся доступен в памяти */ }
    for (const listener of listeners) listener(get());
  }

  function load() {
    try {
      const raw = backend?.getItem(key);
      state = raw ? normalize(JSON.parse(raw)) : fresh();
    } catch (error) {
      state = fresh();
    }
    if (!backend) state = state || fresh();
    return get();
  }

  function get() {
    if (!state) load();
    return JSON.parse(JSON.stringify(state));
  }

  function record(type, summary, at = now()) {
    if (!state) load();
    const event = normalizeEvent({
      id: `${Math.floor(at).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      type, summary, at,
    });
    if (!event) return null;
    state.events.push(event);
    state.events = state.events.slice(-MAX_EVENTS);
    persist();
    return { ...event };
  }

  function list({ limit = 100, since = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 100)));
    return get().events.filter((event) => event.at >= Number(since || 0)).slice(-safeLimit).reverse();
  }

  function createReport({ periodMs = DAY_MS, at = now(), type = 'manual-report' } = {}) {
    const from = at - Math.max(60_000, Math.min(7 * DAY_MS, Number(periodMs) || DAY_MS));
    const events = get().events.filter((event) => event.at >= from && event.at <= at);
    const summary = summarize(events, from, at);
    const report = record(type, summary, at);
    state.lastReportAt = at;
    persist();
    return { ...report, from, to: at, summary };
  }

  function maybeCreatePeriodicReport(at = now()) {
    const current = get();
    const baseline = current.lastReportAt || current.createdAt;
    if (at - baseline < DAY_MS) return null;
    const hasActions = current.events.some((event) => event.at > baseline && event.type !== 'periodic-report' && event.type !== 'manual-report');
    if (!hasActions) {
      state.lastReportAt = at;
      persist();
      return null;
    }
    return createReport({ periodMs: DAY_MS, at, type: 'periodic-report' });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  load();
  return { key, get, list, record, createReport, maybeCreatePeriodicReport, subscribe, dayMs: DAY_MS };
}

export const ACTIVITY_LIMITS = { MAX_EVENTS, DAY_MS };
