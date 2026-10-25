/* Настройки: провайдер модели, генерация, тема, шрифт. Хранятся в localStorage браузера. */

import { $ } from './dom.js';

const STORAGE_KEY = 'kaitos.settings.v1';

export const DEFAULT_SETTINGS = {
  provider: 'none',
  model: '',
  baseUrl: '',
  apiKey: '',
  theme: 'dark',
  fontSize: 13,
  temperature: 0.2,
  maxTokens: 2048,
};

export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    /* приватный режим браузера — настройки просто не сохранятся */
  }
}

export function applySettings(settings) {
  document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  document.documentElement.style.setProperty('--code-size', `${Number(settings.fontSize) || 13}px`);

  const chip = $('#model-chip');
  if (chip) {
    chip.textContent = settings.model
      ? `${settings.provider === 'ollama' ? 'Ollama' : settings.provider === 'openai' ? 'API' : 'демо'} · ${settings.model}`
      : 'демо-режим';
  }

  const status = $('#status-model');
  if (status) status.textContent = settings.model ? `модель: ${settings.model}` : 'модель: —';
}

export function initSettings(ctx) {
  const modal = $('#settings-modal');
  const fields = {
    provider: $('#settings-provider'),
    model: $('#settings-model'),
    baseUrl: $('#settings-baseurl'),
    apiKey: $('#settings-apikey'),
    theme: $('#settings-theme'),
    fontSize: $('#settings-fontsize'),
    temperature: $('#settings-temperature'),
    maxTokens: $('#settings-maxtokens'),
  };
  const testButton = $('#settings-test');
  const testResult = $('#settings-test-result');

  function fill(settings) {
    fields.provider.value = settings.provider;
    fields.model.value = settings.model;
    fields.baseUrl.value = settings.baseUrl;
    fields.apiKey.value = settings.apiKey;
    fields.theme.value = settings.theme;
    fields.fontSize.value = String(settings.fontSize);
    if (fields.temperature) fields.temperature.value = String(settings.temperature);
    if (fields.maxTokens) fields.maxTokens.value = String(settings.maxTokens);
    if (testResult) testResult.textContent = '';
  }

  function collect() {
    return {
      provider: fields.provider.value,
      model: fields.model.value.trim(),
      baseUrl: fields.baseUrl.value.trim(),
      apiKey: fields.apiKey.value,
      theme: fields.theme.value,
      fontSize: Number(fields.fontSize.value) || 13,
      temperature: fields.temperature ? Number(fields.temperature.value) : 0.2,
      maxTokens: fields.maxTokens ? Number(fields.maxTokens.value) || 2048 : 2048,
    };
  }

  function open() {
    fill(ctx.settings);
    modal.hidden = false;
    fields.model.focus();
  }

  function close() {
    modal.hidden = true;
  }

  function save() {
    ctx.updateSettings(collect());
    close();
  }

  /* Проверка соединения без сохранения: настройки берём из формы. */
  async function test() {
    if (!testButton || !testResult) return;
    const draft = collect();
    const previous = ctx.settings;
    ctx.settings = { ...ctx.settings, ...draft };
    testButton.disabled = true;
    testResult.textContent = 'Проверяю…';
    testResult.className = 'settings-test';
    try {
      const result = await ctx.llm.test();
      testResult.textContent = `✓ ${result.provider}, ${result.model}: ${result.text}`;
      testResult.classList.add('settings-test--ok');
    } catch (error) {
      testResult.textContent = `✕ ${error.message}`;
      testResult.classList.add('settings-test--err');
    } finally {
      ctx.settings = previous;
      testButton.disabled = false;
    }
  }

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close="settings"]')) close();
  });

  $('#settings-save').addEventListener('click', save);
  $('#btn-settings').addEventListener('click', open);
  if (testButton) testButton.addEventListener('click', test);

  /* Подставляем адрес и модель по умолчанию при смене провайдера. */
  fields.provider.addEventListener('change', () => {
    const provider = fields.provider.value;
    const defaults = {
      ollama: { baseUrl: 'http://localhost:11434', model: 'qwen2.5-coder:7b' },
      openai: { baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' },
      none: { baseUrl: '', model: '' },
    }[provider];
    if (!defaults) return;
    if (!fields.baseUrl.value.trim() || fields.baseUrl.dataset.auto === '1') {
      fields.baseUrl.value = defaults.baseUrl;
      fields.baseUrl.dataset.auto = '1';
    }
    if (!fields.model.value.trim() || fields.model.dataset.auto === '1') {
      fields.model.value = defaults.model;
      fields.model.dataset.auto = '1';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      event.preventDefault();
      close();
    }
  });

  return { open, close, save, test, fill, collect };
}
