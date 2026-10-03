// Builds Google-shaped revision history so tests go through the real parser.
// Positions follow Google's convention: `is` uses a 1-based ibi, `ds` an
// inclusive 1-based si..ei (pass { inclusive: false } to emit the other reading).

export class Synth {
  constructor({ start = Date.UTC(2026, 9, 1, 14, 0, 0), user = 'user-1', inclusive = true } = {}) {
    this.text = '';
    this.t = start;
    this.user = user;
    this.rev = 0;
    this.log = [];
    this.inclusive = inclusive;
    this.snapshotText = '';
  }

  // Text that exists before the visible history (a template or imported file).
  preexisting(text) {
    this.snapshotText = text;
    this.text = text;
    return this;
  }

  as(user) { this.user = user; return this; }
  wait(ms) { this.t += ms; return this; }
  minutes(n) { return this.wait(n * 60 * 1000); }

  entry(cmd) {
    this.rev++;
    this.log.push([cmd, this.t, this.user, this.rev, 'sess-1', this.rev, null, null, false]);
    return this;
  }

  find(s, from = 0) {
    const k = this.text.indexOf(s, from);
    if (k < 0) throw new Error(`synth: "${s}" not in text`);
    return k;
  }

  isCmd(s, at) { return { ty: 'is', ibi: at + 1, s }; }
  dsCmd(at, len) { return { ty: 'ds', si: at + 1, ei: this.inclusive ? at + len : at + len + 1 }; }

  insert(s, at = this.text.length) {
    this.text = this.text.slice(0, at) + s + this.text.slice(at);
    return this.entry(this.isCmd(s, at));
  }

  del(at, len) {
    this.text = this.text.slice(0, at) + this.text.slice(at + len);
    return this.entry(this.dsCmd(at, len));
  }

  // Typing: a few characters per saved change, about `cps` characters a second.
  type(s, { at = this.text.length, cps = 5, chunk = 3 } = {}) {
    let p = at;
    for (let k = 0; k < s.length; k += chunk) {
      const part = s.slice(k, k + chunk);
      this.wait(Math.round((part.length / cps) * 1000));
      this.insert(part, p);
      p += part.length;
    }
    return this;
  }

  backspace(n, { at = this.text.length } = {}) {
    for (let k = 0; k < n; k++) { this.wait(150); this.del(at - 1 - k, 1); }
    return this;
  }

  // Select a range and type over it.
  retype(oldText, newText, opts = {}) {
    const at = this.find(oldText, opts.from ?? 0);
    this.wait(1000).del(at, oldText.length);
    return this.type(newText, { ...opts, at });
  }

  cutPaste(s, to) {
    const at = this.find(s);
    this.wait(1000).del(at, s.length);
    const dest = typeof to === 'function' ? to(this) : to;
    return this.wait(1500).insert(s, dest);
  }

  multi(cmds) { return this.entry({ ty: 'mlti', mts: cmds }); }

  page({ withSnapshot = true } = {}) {
    const chunked = withSnapshot && this.snapshotText ? [[{ ty: 'is', ibi: 1, s: this.snapshotText }]] : [];
    return `)]}'\n${JSON.stringify({ changelog: this.log, chunkedSnapshot: chunked })}`;
  }

  // History split into pages the way the fetcher requests it.
  pages(size = 1000) {
    const out = [];
    for (let k = 0; k < this.log.length; k += size) {
      const chunked = k === 0 && this.snapshotText ? [[{ ty: 'is', ibi: 1, s: this.snapshotText }]] : [];
      out.push(`)]}'\n${JSON.stringify({ changelog: this.log.slice(k, k + size), chunkedSnapshot: chunked })}`);
    }
    return out.length ? out : [this.page()];
  }
}

export const LOREM = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat'.split(' ');

export function lorem(words, seed = 1) {
  const out = [];
  let x = seed;
  for (let k = 0; k < words; k++) { x = (x * 9301 + 49297) % 233280; out.push(LOREM[x % LOREM.length].toLowerCase()); }
  // Capitalised, so sentence breaks fall where a reader expects them.
  return out.join(' ').replace(/^./, (c) => c.toUpperCase());
}
