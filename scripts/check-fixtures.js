// Fails if a fixture still holds anything that could identify a person or an
// account. Run by npm test over everything in fixtures/, and by scrub-fixture
// before it writes.

const RULES = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an email address'],
  [/\b\d{15,}\b/, 'a long numeric id'],
  [/googleusercontent/i, 'a Google profile photo link'],
  [/"(token|ouid|userMap|userInfo|photo|revisionMac|name|email)"\s*:/, 'an account field'],
  [/\/Users\/|C:\\\\Users\\\\|\/home\//, 'a local file path'],
  [/1[A-Za-z0-9_-]{40,}/, 'a Google document id'],
];

export function checkFixtureText(text) {
  const problems = [];
  for (const [re, what] of RULES) if (re.test(text)) problems.push(what);
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    const p = checkFixtureText(readFileSync(f, 'utf8'));
    if (p.length) { bad++; console.log(`${f}: ${p.join(', ')}`); }
  }
  process.exit(bad ? 1 : 0);
}
