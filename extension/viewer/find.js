// Search inside the document view and jump between sections. Matches are
// painted with the CSS Custom Highlight API, so the document's DOM (and the
// passage spans in it) is never rewritten.

import { h, clear } from './dom.js';

export class Finder {
  constructor(root, input, count, prev, next) {
    Object.assign(this, { root, input, count, ranges: [], k: 0 });
    input.addEventListener('input', () => this.refresh());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { input.value = ''; this.refresh(); }
    });
    prev.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
  }

  refresh() {
    const q = this.input.value.trim().toLowerCase();
    this.ranges = [];
    this.k = 0;
    if (q.length >= 2) {
      // Concatenate the text nodes, search once, then map hits back to nodes.
      const nodes = [], starts = [];
      let text = '';
      const walk = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) { nodes.push(n); starts.push(text.length); text += n.nodeValue; }
      const lower = text.toLowerCase();
      const locate = (pos) => {
        let lo = 0, hi = nodes.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
        return [nodes[lo], pos - starts[lo]];
      };
      for (let at = lower.indexOf(q); at >= 0 && this.ranges.length < 1000; at = lower.indexOf(q, at + q.length)) {
        const r = new Range();
        r.setStart(...locate(at));
        const [endNode, endOff] = locate(at + q.length - 1);
        r.setEnd(endNode, endOff + 1);
        this.ranges.push(r);
      }
    }
    this.paint();
  }

  step(d) {
    if (!this.ranges.length) return;
    this.k = (this.k + d + this.ranges.length) % this.ranges.length;
    this.paint();
  }

  paint() {
    const n = this.ranges.length;
    this.count.textContent = this.input.value.trim().length >= 2 ? (n ? `${this.k + 1} of ${n}${n >= 1000 ? '+' : ''}` : 'No matches') : '';
    if (!globalThis.CSS || !CSS.highlights) return;
    CSS.highlights.delete('wh-find');
    CSS.highlights.delete('wh-find-current');
    if (!n) return;
    CSS.highlights.set('wh-find', new Highlight(...this.ranges));
    const cur = this.ranges[this.k];
    CSS.highlights.set('wh-find-current', new Highlight(cur));
    const el = cur.startContainer.parentElement;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// "Jump to section": the document's headings (Heading 1–6), the same
// sections the dashboard lines up. Hidden when there are none.
export function renderSections(select, root, sections = []) {
  clear(select);
  const items = sections.map((sec) => ({ sec, el: root.querySelector(`[data-para="${sec.para}"]`) })).filter((x) => x.el);
  select.hidden = items.length === 0;
  select.appendChild(h('option', { value: '', text: 'Jump to section…' }));
  items.forEach(({ sec, el }, k) => {
    el.id = `wh-sec-${k}`;
    el.classList.add('sec-anchor');
    const indent = Math.max(0, (sec.level || 1) - 1);
    select.appendChild(h('option', { value: el.id, text: `${'\u2003'.repeat(indent)}${sec.label.slice(0, 80) || '(untitled)'}` }));
  });
  select.onchange = () => {
    const el = select.value && document.getElementById(select.value);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    select.value = '';
  };
}
