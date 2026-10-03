// What the summary card and the printed report say about the whole document.

import { CATEGORY_TEXT } from './wording.js';
import { CAT_ORDER } from './classify.js';

export function duration(ms) {
  if (!ms) return '0 min';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function pct(x) {
  return `${Math.round((x || 0) * 100)}%`;
}

export function summaryRows(summary, mode = 'teacher') {
  const T = CATEGORY_TEXT[mode];
  const rows = [
    ['Words', String(summary.words)],
    ['Active writing time (estimate)', duration(summary.activeMs)],
    ['Writing sessions', String(summary.sessions)],
    ['Days with edits', String(summary.activeDays)],
    ['Editors', String(summary.editors)],
    ['Largest single insertion', summary.largestInsert ? `${summary.largestInsert.n} characters` : 'none'],
  ];
  for (const c of CAT_ORDER) {
    if (summary.shares[c] > 0) rows.push([T[c].label, pct(summary.shares[c])]);
  }
  return rows;
}

export const METHOD_NOTES = [
  'Built from the edit history Google Docs keeps for every document. Nothing was sent anywhere; the analysis ran in this browser.',
  'Each sentence is coloured by how its surviving characters were produced. Sentences that mix clearly different histories are split.',
  'Google’s history does not record where inserted text came from. Large insertions can be pastes, dictation, other extensions or Google features.',
  'Active time is estimated from gaps of two minutes or less between edits; a new session starts after 30 minutes without edits.',
  'Writing in order with little revision is common for fluent writers and also for retyping. No pattern here shows who wrote the text or why.',
];
