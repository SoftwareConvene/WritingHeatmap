// The document's sections, so the same part of every student's copy can be
// lined up. By default only the paragraphs styled Heading 1–6, the same ones a
// Google Docs table of contents lists; Title and Subtitle are not in a table of
// contents, so they are not sections either. With headingsOnly off, the Title
// and the template's own prompts ("Hypothesis:", "Question 2: ...") that every
// copy starts with count too. A heading that came with the template is
// named by its template text, so a student typing on the heading's line does
// not stop their copy lining up with the others.

import { isBlank } from './gdocs/kixtext.js';
import { OWNER_PROVIDED } from './authors.js';

export const SECTION = Object.freeze({ MIN_PROMPT: 8, MAX_LABEL: 160 });

export function sectionKey(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s:.\-–—_]+$/, '');
}

// seg: segment() output for one tab; arr: its char records; spans: classified.
export function sectionsOf(seg, arr, ownerOf, spans, { headingsOnly = true } = {}) {
  const anchors = [];
  seg.paragraphs.forEach((p, idx) => {
    // The paragraph's opening template (provided) text.
    let d = p.start, real = 0;
    for (; d < p.end; d++) {
      const r = arr[seg.map[d]];
      if (isBlank(r.c)) continue;
      if (ownerOf(r) !== OWNER_PROVIDED) break;
      real++;
    }
    const prompt = seg.text.slice(p.start, d).trim();
    const h = p.ps && Number(p.ps.h);
    if ((h >= 1 && h <= 6) || (h === 100 && !headingsOnly)) {
      const text = prompt || seg.text.slice(p.start, p.end).trim();
      if (text) anchors.push({ para: idx, label: text.slice(0, SECTION.MAX_LABEL), kind: 'heading', level: h === 100 ? 0 : h });
      return;
    }
    if (!headingsOnly && real >= SECTION.MIN_PROMPT && prompt.length <= SECTION.MAX_LABEL) anchors.push({ para: idx, label: prompt, kind: 'prompt', level: 9 });
  });
  // A heading's section runs to the next heading at its level or above, so a
  // Heading 1 includes the Heading 2s under it, as in a table of contents.
  // The Title and template lines end at the next anchor of any kind.
  const out = anchors.map((a, k) => {
    let next = k + 1;
    if (a.kind === 'heading' && a.level > 0) while (next < anchors.length && anchors[next].kind === 'heading' && anchors[next].level > a.level) next++;
    const endPara = next < anchors.length ? anchors[next].para : seg.paragraphs.length;
    const words = {};
    for (const sp of spans) if (sp.para >= a.para && sp.para < endPara) words[sp.owner] = (words[sp.owner] || 0) + (sp.words || 0);
    return {
      key: sectionKey(a.label), label: a.label, kind: a.kind, level: a.level, para: a.para, endPara,
      start: seg.paragraphs[a.para].start, end: seg.paragraphs[endPara - 1].end, words,
    };
  });
  return distinctKeys(out);
}

// A heading used twice ("Conclusion" in the report and again on the board)
// is told apart by the heading it sits under, the same in every copy:
// "Conclusion (Write-Up: Board)", leaving off a "(Due: …)" at the end of
// that heading. Still the same: numbered in order.
function distinctKeys(sections) {
  const count = (list) => list.reduce((m, s) => m.set(s.key, (m.get(s.key) || 0) + 1), new Map());
  const twice = count(sections);
  const parents = sections.map((s, k) => {
    for (let j = k - 1; j >= 0; j--) {
      const p = sections[j];
      if (p.kind === 'heading' && s.kind === 'heading' && p.level > 0 && p.level < s.level && p.endPara >= s.endPara) return p;
    }
    return null;
  });
  const named = sections.map((s, k) => {
    const p = parents[k];
    if (twice.get(s.key) < 2 || !p) return s;
    return { ...s, key: `${p.key} › ${s.key}`, label: `${s.label} (${p.label.replace(/\s*\([^()]*\)\s*$/, '') || p.label})` };
  });
  const still = count(named);
  const seen = new Map();
  return named.map((s) => {
    if (still.get(s.key) < 2) return s;
    const n = (seen.get(s.key) || 0) + 1;
    seen.set(s.key, n);
    return n === 1 ? s : { ...s, key: `${s.key} #${n}`, label: `${s.label} (${n})` };
  });
}
