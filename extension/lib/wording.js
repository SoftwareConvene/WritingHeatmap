// Every sentence the viewer shows about a passage lives here, in a teacher set
// and a student set. The rule (enforced by a test): describe what the history
// recorded, never what the writer intended. No verdict words.

export const CATEGORY_TEXT = {
  teacher: {
    linear: {
      label: 'Written straight through',
      short: 'Typed in order, little changed after.',
      long: 'This was typed in order, at the end of what was already there, and barely changed afterwards. Fluent writing looks like this, and so does copying text out from another source or dictating it.',
    },
    light: {
      label: 'Some revising',
      short: 'Partly reworded later.',
      long: 'After this was first written, some of it was deleted, reworded or added to.',
    },
    heavy: {
      label: 'Major revisions',
      short: 'Largely rewritten later.',
      long: 'After this was first written, much of it was deleted or reworded, or the student came back to it later and rewrote it.',
    },
    large: {
      label: 'Added all at once',
      short: 'Arrived in big pieces, not typed.',
      long: "Most of this arrived in big pieces rather than being typed a few letters at a time. Google's history doesn't say where it came from: pasting, dictation, another extension or a Google feature can all do this.",
    },
    pasted: {
      label: 'Pasted',
      short: 'The history records this text as pasted.',
      long: 'Google’s history marks most of this passage as pasted in.',
    },
    unclear: {
      label: 'History unclear',
      short: "Google's history doesn't explain it.",
      long: "This text was already in the document when its history begins (a template, an imported file, a restored version or a copy), or the rebuilt history doesn't match what is there now.",
    },
    mixed: {
      label: 'Mixed',
      short: 'Written in different ways.',
      long: 'Parts of this were written in different ways. Press ▶ Play how this was written to see each step.',
    },
    provided: {
      label: 'Already in the document',
      short: 'There before the student started.',
      long: 'This text was in the document before the visible history begins (a Classroom template, a prompt, an imported file), or was added by an editor marked as Provided. It is set aside: only what students added is colored.',
    },
    teacher: {
      label: 'Added by the teacher',
      short: 'Written by an editor marked as Teacher.',
      long: 'An editor marked as Teacher added this text. It is set aside: only what students added is colored.',
    },
  },
  student: {
    linear: { label: 'Written in place', short: 'You wrote this mostly in order and changed it little later.', long: 'You typed this at the end of the paragraph and changed it little afterwards.' },
    light: { label: 'Some revising', short: 'You went back and changed some of this.', long: 'After you first wrote this, you deleted, replaced or added some of it.' },
    heavy: { label: 'Lots of revising', short: 'You rewrote a lot of this.', long: 'You came back and rewrote much of this passage after writing it.' },
    large: { label: 'Added all at once', short: 'This arrived in one large chunk.', long: 'Most of this passage arrived in large pieces at a time, as happens when text is pasted, dictated, or inserted by a tool.' },
    pasted: { label: 'Pasted', short: 'The history records this as pasted.', long: 'Google’s history marks most of this passage as pasted in.' },
    unclear: { label: 'History unclear', short: 'The history does not fully explain this text.', long: 'This text was already in the document when the history begins, or the history does not match it.' },
    mixed: { label: 'Mixed', short: 'Parts of this were written in different ways.', long: 'Open the passage to see each step.' },
    provided: { label: 'Already there', short: 'This was in the document before you started.', long: 'This text was already in the document, for example the assignment template.' },
    teacher: { label: 'From your teacher', short: 'Your teacher added this.', long: 'Your teacher added this text.' },
  },
};

export const BADGE_TEXT = {
  insertedThenEdited: 'Added all at once, then heavily reworded',
  moved: 'Moved or copied from elsewhere in the Doc',
  removedNear: 'A big block of text was deleted right next to this',
  suggestion: 'Contains suggested edits',
  retyped: 'Typed beside a paste that was then deleted',
};

// Other ways the same record can come about. Shown wherever a category is
// explained so the evidence never stands alone.
export const ALTERNATIVES = {
  linear: ['fluent writing', 'retyping text from another source', 'voice typing', 'text planned or drafted beforehand'],
  light: ['ordinary editing', 'a spelling or grammar tool', 'peer or teacher feedback'],
  heavy: ['drafting and redrafting', 'a rewriting tool', 'peer or teacher feedback'],
  large: ['a draft written in another app or on paper', 'voice typing', 'another extension', 'Smart Compose or another Google feature', 'pasted notes, quotations or research'],
  pasted: ['a draft written in another app', 'quotations or research notes', 'text from the teacher or the assignment'],
  unclear: ['a Classroom template', 'an imported Word file', 'a restored version or copy', 'history Google did not keep'],
  mixed: [],
  provided: [],
  teacher: [],
};

export const BANNERS = {
  noPasteMarker: "Google's history doesn't record pastes. Text that arrived all at once is shown in red, but whether it was pasted, dictated or added by another tool isn't known.",
  historyStart: 'This document already had text in it when its history begins (a template, a prompt or an imported file). That text is shown in gray as Already in the document, and only what students added is colored.',
  startProvided: 'This document’s first edit added a block of text at once, as happens when Classroom or “Make a copy” creates it from a template. That starting text is treated as provided: it is gray and not counted as any student’s work.',
  startStudent: 'This document’s first edit added a block of text at once. You chose to count it as the student’s own writing.',
  mismatch: "The rebuilt history does not fully match the document's current text. Paragraphs that do not match are shown as History unclear.",
  unverified: "The rebuilt text could not be checked against Google's copy of the document, so treat the colors with extra care.",
  asOf: (s) => `You are looking at the document as it stood on ${new Date(s.asOf).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Later edits are not shown.`,
  collaborators: () => 'More than one student edited this document. See “Who wrote what”, or color the document by writer.',
  partial: 'Some edits in this history were not recognized. The colors may be incomplete.',
  evidence: 'This shows how the text got into the document. It can’t tell you who was at the keyboard or why, so use it to start a conversation with the student, not as proof on its own.',
};

export const WHEN_TEXT = {
  school: { label: 'During school hours', short: 'Written on a school day, within the school hours set in Settings.' },
  home: { label: 'Outside school hours', short: 'Written in the evening, on a weekend, or otherwise outside school hours.' },
  late: { label: 'After the due date', short: 'Written after the due date you set for this document.' },
};

export const ROLE_TEXT = {
  student: 'Student',
  teacher: 'Teacher',
  provided: 'Provided',
};

export const ROLE_HELP = 'Only Student text is colored and counted. Set yourself to Teacher.';

// A passage typed beside a paste that was then deleted.
export const RETYPED_TEXT = {
  title: 'Typed beside a paste that was then deleted',
  key: 'Typed beside a deleted paste',
  legend: 'Typed next to a paste that was later deleted.',
  when: (pasted, gone, n) => `Pasted ${pasted} (${n.toLocaleString()} characters), deleted ${gone}.`,
  shared: (shared, of) => `${shared} of ${of} main words match the paste (highlighted).`,
  cut: 'The paste was longer; only its start is shown.',
};

// The Passage box's before-and-after for a large insertion changed since.
const nWords = (n) => `${n} word${n === 1 ? '' : 's'}`;
export const ORIGINAL_TEXT = {
  title: 'Compared with when it was added',
  first: 'As first added',
  now: 'Now',
  added: (when, n) => `Added all at once: ${when}, ${n.toLocaleString()} characters`,
  counts: ({ removed, added }) => `Since then: ${nWords(removed)} removed, ${nWords(added)} added.`,
  key: 'Struck: removed. Underlined: added.',
  sentence: 'Whole sentence shown.',
};

export const ERRORS = {
  NOT_A_DOC: 'Open a Google Doc first, then click the extension icon.',
  NO_ACCESS: 'You need edit access to this document to see its history. Ask the student to share it with you as an Editor, or open it from Google Classroom.',
  FORMAT_CHANGED: "Google's history format looks different from what this version understands. Turn on testing tools in Settings, save the raw history of one of your own test documents, and report it.",
  NO_HISTORY: 'No editing history was found for this document.',
  FETCH_FAILED: 'The history could not be loaded. Reload the document tab and try again.',
  TAB_CLOSED: 'The document tab was closed or reloaded. Click the extension icon on the document again.',
  ANALYSIS_FAILED: 'The history loaded but could not be analyzed. Try Refresh. If it keeps happening, report it with the steps that led to it.',
  ANALYSIS_CRASHED: 'The analysis ran out of memory or stopped unexpectedly on this document. Try Refresh. If it keeps happening, report it.',
  ANALYSIS_STOPPED: 'Analysis stopped. Press Refresh to try again.',
};

export function eventText(ev, actorName, large = 80) {
  const who = actorName || 'Someone';
  switch (ev.op) {
    case 'ins': return ev.n >= large ? `${who} inserted ${ev.n} characters at once` : `${who} typed ${ev.n} character${ev.n === 1 ? '' : 's'}`;
    case 'del': return `${who} deleted ${ev.len} character${ev.len === 1 ? '' : 's'}`;
    case 'sugins': return `${who} suggested ${ev.n} characters`;
    case 'sugdel': return `${who} removed ${ev.len} suggested characters`;
    case 'reset': return `The whole text was replaced (${ev.n} characters)`;
    default: return `${who} made an edit`;
  }
}
