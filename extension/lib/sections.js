// The document's sections, so the same part of every student's copy can be
// lined up: the paragraphs styled Heading 1–6, the same ones a Google Docs
// table of contents lists. Title and Subtitle are not in a table of contents,
// so they are not sections either. A heading that came with the template is
// named by its template text, so a student typing on the heading's line does
// not stop their copy lining up with the others.

import { isBlank } from './gdocs/kixtext.js';
import { OWNER_PROVIDED } from './authors.js';

export const SECTION = Object.freeze({ MAX_LABEL: 160 });

export function sectionKey(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s:.\-–—_]+$/, '');
}

// seg: segment() output for one tab; arr: its char records; spans: classified.
export function sectionsOf(seg, arr, ownerOf, spans) {
  const anchors = [];
  seg.paragraphs.forEach((p, idx) => {
    const h = p.ps && Number(p.ps.h);
    if (!(h >= 1 && h <= 6)) return;
    let d = p.start;
    for (; d < p.end; d++) {
      const r = arr[seg.map[d]];
      if (!isBlank(r.c) && ownerOf(r) !== OWNER_PROVIDED) break;
    }
    const text = (seg.text.slice(p.start, d).trim() || seg.text.slice(p.start, p.end)).trim();
    if (text) anchors.push({ para: idx, label: text.slice(0, SECTION.MAX_LABEL), level: h });
  });
  return anchors.map((a, k) => {
    const endPara = k + 1 < anchors.length ? anchors[k + 1].para : seg.paragraphs.length;
    const words = {};
    for (const sp of spans) if (sp.para >= a.para && sp.para < endPara) words[sp.owner] = (words[sp.owner] || 0) + (sp.words || 0);
    return {
      key: sectionKey(a.label), label: a.label, kind: 'heading', level: a.level, para: a.para, endPara,
      start: seg.paragraphs[a.para].start, end: seg.paragraphs[endPara - 1].end, words,
    };
  });
}
