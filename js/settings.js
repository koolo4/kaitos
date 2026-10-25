/* Настройки: провайдер модели, тема, размер шрифта. Хранятся в localStorage браузера. */

import { $ } from './dom.js';

const STORAGE_KEY = 'kaitos.settings.v1';

export const DEFAULT_SETTINGS = {
  provider: 'none',
  model: '',
  baseUrl: '',
  apiKey: '',
  theme: 'dark',
  fontSize: 13,
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
  if (chip) chip.textContent = settings.model ? settings.model : 'модель не выбрана';

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
  };

  function fill(settings) {
    fields.provider.value = settings.provider;
    fields.model.value = settings.model;
    fields.baseUrl.value = settings.baseUrl;
    fields.apiKey.value = settings.apiKey;
    fields.theme.value = settings.theme;
    fields.fontSize.value = String(settings.fontSize);
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
    ctx.updateSettings({
      provider: fields.provider.value,
      model: fields.model.value.trim(),
      baseUrl: fields.baseUrl.value.trim(),
      apiKey: fields.apiKey.value,
      theme: fields.theme.value,
      fontSize: Number(fields.fontSize.value) || 13,
    });
    close();
  }

  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close="settings"]')) close();
  });

  $('#settings-save').addEventListener('click', save);
  $('#btn-settings').addEventListener('click', open);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      event.preventDefault();
      close();
    }
  });

  return { open, close, save, fill };
}
