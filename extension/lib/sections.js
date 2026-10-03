// The document's sections, so the same part of every student's copy can be
// lined up: headings, and the template's own prompts ("Hypothesis:",
// "Question 2: ...") that every copy starts with.

import { isBlank } from './gdocs/kixtext.js';
import { OWNER_PROVIDED } from './authors.js';

export const SECTION = Object.freeze({ MIN_PROMPT: 8, MAX_LABEL: 160 });

export function sectionKey(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s:.\-–—_]+$/, '');
}

// seg: segment() output for one tab; arr: its char records; spans: classified.
export function sectionsOf(seg, arr, ownerOf, spans) {
  const anchors = [];
  seg.paragraphs.forEach((p, idx) => {
    const text = seg.text.slice(p.start, p.end);
    if (!text.trim()) return;
    const h = p.ps && Number(p.ps.h);
    if ((h >= 1 && h <= 6) || h === 100) {
      anchors.push({ para: idx, label: text.trim().slice(0, SECTION.MAX_LABEL), kind: 'heading', level: h === 100 ? 0 : h });
      return;
    }
    // A prompt: the paragraph opens with provided (template) text.
    let d = p.start, real = 0;
    for (; d < p.end; d++) {
      const r = arr[seg.map[d]];
      if (isBlank(r.c)) continue;
      if (ownerOf(r) !== OWNER_PROVIDED) break;
      real++;
    }
    const prompt = seg.text.slice(p.start, d).trim();
    if (real >= SECTION.MIN_PROMPT && prompt.length <= SECTION.MAX_LABEL) anchors.push({ para: idx, label: prompt, kind: 'prompt', level: 9 });
  });
  return anchors.map((a, k) => {
    const endPara = k + 1 < anchors.length ? anchors[k + 1].para : seg.paragraphs.length;
    const words = {};
    for (const sp of spans) if (sp.para >= a.para && sp.para < endPara) words[sp.owner] = (words[sp.owner] || 0) + (sp.words || 0);
    return {
      key: sectionKey(a.label), label: a.label, kind: a.kind, level: a.level, para: a.para, endPara,
      start: seg.paragraphs[a.para].start, end: seg.paragraphs[endPara - 1].end, words,
    };
  });
}
