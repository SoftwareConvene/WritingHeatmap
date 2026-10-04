// The replay dialog: plays the edits behind one passage, one section, or the
// whole document. Text is the raw document string; displayText turns it into
// what a reader sees.

import { h, clear, fmtTime } from './dom.js';
import { displayText } from '../lib/gdocs/kixtext.js';
import { applyToText } from '../lib/replay.js';
import { eventText } from '../lib/wording.js';

export class ReplayUI {
  constructor(dialog, actorName) {
    this.d = dialog;
    this.actorName = actorName;
    this.q = (id) => dialog.querySelector(`#${id}`);
    this.frames = [];
    this.k = 0;
    this.timer = null;
    this.q('replay-close').onclick = () => this.close();
    this.q('rp-play').onclick = () => (this.timer ? this.pause() : this.play());
    this.q('rp-step').onclick = () => { this.pause(); this.go(this.k + 1); };
    this.q('rp-back').onclick = () => { this.pause(); this.go(this.k - 1); };
    this.q('rp-pos').oninput = (e) => { this.pause(); this.go(Number(e.target.value)); };
    dialog.addEventListener('close', () => this.pause());
  }

  // windows: [{ startText, steps }] from Replayer.window. Only every 50th
  // frame keeps its full text; the rest are rebuilt from the nearest one.
  open(windows, title = 'How this passage was written', { autoplay = true } = {}) {
    this.q('replay-title').textContent = title;
    this.frames = [];
    windows.forEach((w, wi) => {
      let text = w.startText;
      this.frames.push({ text, step: null, gap: wi > 0 });
      w.steps.forEach((st, k) => {
        text = applyToText(text, st);
        this.frames.push({ text: (k + 1) % 50 === 0 ? text : null, step: st });
      });
    });
    const pos = this.q('rp-pos');
    pos.max = String(Math.max(0, this.frames.length - 1));
    this.go(0);
    this.d.showModal();
    if (autoplay && this.frames.length > 1) this.play();
  }

  textAt(k) {
    let j = k;
    while (this.frames[j].text == null) j--;
    let text = this.frames[j].text;
    for (let x = j + 1; x <= k; x++) text = applyToText(text, this.frames[x].step);
    return text;
  }

  close() { this.pause(); this.d.close(); }

  play() {
    if (this.k >= this.frames.length - 1) this.go(0);
    this.q('rp-play').textContent = '❚❚ Pause';
    // 1× is 2.5 edits a second (a keystroke at a time); faster speeds move
    // several edits per frame so a long essay plays in under a minute.
    const tick = () => {
      if (this.k >= this.frames.length - 1) { this.pause(); return; }
      const perSec = 2.5 * Number(this.q('rp-speed').value);
      const wait = Math.max(16, 1000 / perSec);
      this.go(this.k + Math.max(1, Math.round(perSec * wait / 1000)));
      if (this.k >= this.frames.length - 1) { this.pause(); return; }
      this.timer = setTimeout(tick, wait);
    };
    this.timer = setTimeout(tick, 50);
  }

  pause() {
    clearTimeout(this.timer);
    this.timer = null;
    this.q('rp-play').textContent = '▶ Play';
  }

  go(k) {
    k = Math.max(0, Math.min(this.frames.length - 1, k));
    this.k = k;
    this.q('rp-pos').value = String(k);
    const f0 = this.frames[k];
    const box = clear(this.q('rp-text'));
    const label = this.q('rp-label');
    if (!f0) { label.textContent = ''; return; }
    const f = { ...f0, text: this.textAt(k) };
    if (f.gap) box.appendChild(h('span', { class: 'rp-gap', text: '… later in the history …' }));
    const st = f.step;
    let mark = null;
    if (st && (st.op === 'ins' || st.op === 'sugins')) {
      const a = Math.max(0, Math.min(st.pos, f.text.length));
      box.append(displayText(f.text.slice(0, a)));
      mark = h('span', { class: 'rp-ins', text: displayText(f.text.slice(a, a + st.text.length)) });
      box.append(mark, displayText(f.text.slice(a + st.text.length)));
    } else if (st && (st.op === 'del' || st.op === 'sugdel')) {
      const a = Math.max(0, Math.min(st.pos, f.text.length));
      box.append(displayText(f.text.slice(0, a)));
      mark = h('span', { class: 'rp-del', title: `${st.len} characters deleted` });
      box.append(mark, displayText(f.text.slice(a)));
    } else {
      box.append(displayText(f.text));
    }
    if (mark) mark.scrollIntoView({ block: 'center' });
    label.textContent = st
      ? `${fmtTime(st.t)} · ${eventText({ op: st.op, n: st.text.length, len: st.len }, this.actorName(st.actor), this.large ?? 80)}${st.relevant ? ' · this passage' : ''}`
      : k === 0 ? 'Start' : 'Start of this part of the history';
  }
}
