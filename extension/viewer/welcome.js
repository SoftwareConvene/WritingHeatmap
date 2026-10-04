// First-run setup guide. Each choice saves as soon as it is made; finishing
// marks the setup done, which hides the "Finish setting up" links.

import { h } from './dom.js';
import { DEFAULT_SETTINGS, patchSettings, applyPalette } from './prefs.js';

const $ = (id) => document.getElementById(id);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const steps = [...document.querySelectorAll('.w-step')];
const dots = [...document.querySelectorAll('.w-dots li')];
let at = 0;
let settings = structuredClone(DEFAULT_SETTINGS);

async function save(patch, note = 'Saved.') {
  settings = await patchSettings(patch);
  applyPalette(settings);
  $('w-saved').textContent = note;
}

function show(k) {
  at = Math.max(0, Math.min(steps.length - 1, k));
  steps.forEach((s, j) => { s.hidden = j !== at; });
  dots.forEach((d, j) => d.classList.toggle('on', j <= at));
  $('w-back').hidden = at === 0;
  $('w-next').textContent = at === 0 ? 'Start' : at === steps.length - 1 ? 'Finish' : 'Next';
  $('w-saved').textContent = '';
  const first = steps[at].querySelector('input:checked, input');
  if (first && at > 0) first.focus();
}

function schedule() {
  return {
    days: [...$('w-days').querySelectorAll('input:checked')].map((b) => Number(b.value)),
    start: $('w-start').value || DEFAULT_SETTINGS.schedule.start,
    end: $('w-end').value || DEFAULT_SETTINGS.schedule.end,
  };
}

(async () => {
  const { settings: stored } = await chrome.storage.local.get('settings');
  settings = { ...structuredClone(DEFAULT_SETTINGS), ...(stored || {}) };
  applyPalette(settings);
  const sch = settings.schedule || DEFAULT_SETTINGS.schedule;
  DAYS.forEach((name, k) => $('w-days').appendChild(h('label', { class: 'day' }, h('input', { type: 'checkbox', value: String(k), checked: sch.days.includes(k) }), ` ${name}`)));
  $('w-start').value = sch.start;
  $('w-end').value = sch.end;
  document.querySelector(`input[name=school][value=${settings.schoolOn === true ? 'on' : 'off'}]`).checked = true;
  $('w-hours').disabled = settings.schoolOn !== true;
  document.querySelector(`input[name=palette][value=${settings.colorBlind ? 'cb' : 'standard'}]`).checked = true;
  document.querySelector(`input[name=button][value=${settings.showButton === false ? 'off' : 'on'}]`).checked = true;

  for (const r of document.querySelectorAll('input[name=school]')) r.addEventListener('change', () => {
    const on = r.value === 'on';
    $('w-hours').disabled = !on;
    save(on ? { schoolOn: true, schedule: schedule() } : { schoolOn: false });
  });
  $('w-hours').addEventListener('change', () => save({ schoolOn: true, schedule: schedule() }));
  for (const r of document.querySelectorAll('input[name=palette]')) r.addEventListener('change', () => save({ colorBlind: r.value === 'cb' }));
  for (const r of document.querySelectorAll('input[name=button]')) r.addEventListener('change', () => save({ showButton: r.value === 'on' }, 'Saved. Reload a Doc that is already open to see the change.'));

  $('w-back').addEventListener('click', () => show(at - 1));
  $('w-next').addEventListener('click', async () => {
    if (at < steps.length - 1) return show(at + 1);
    await save({ onboarded: true }, 'All set. You can close this tab.');
    $('w-next').disabled = true;
  });
  show(0);
})();
