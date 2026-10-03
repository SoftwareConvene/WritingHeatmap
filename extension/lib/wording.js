// Every sentence the viewer shows about a passage lives here, in a teacher set
// and a student set. The rule (enforced by a test): describe what the history
// recorded, never what the writer intended. No verdict words.

export const CATEGORY_TEXT = {
  teacher: {
    linear: {
      label: 'Composed in place',
      short: 'Written mostly in order, with little later revision.',
      long: 'These characters were typed at the end of their paragraph and changed little afterwards. That pattern fits fluent writing, retyping from another source, dictation, or prepared text alike.',
    },
    light: {
      label: 'Lightly revised',
      short: 'Some rewriting or rearrangement after it was first written.',
      long: 'After this passage was first written, some of it was deleted, replaced or added to.',
    },
    heavy: {
      label: 'Heavily revised',
      short: 'Substantial rewriting after it was first written.',
      long: 'This passage was rewritten a lot after it was first written: many characters were deleted or replaced, or the writer came back to it after moving on.',
    },
    large: {
      label: 'Large insertion',
      short: 'Entered in one large insertion; the source is not recorded.',
      long: "Most of this passage arrived in insertions of 80 or more characters at once. Google's history does not record where such text comes from: a paste, dictation, another extension, or a Google feature can all produce it.",
    },
    pasted: {
      label: 'Pasted',
      short: 'The history records this text as pasted.',
      long: 'Google’s history marks most of this passage as pasted in.',
    },
    unclear: {
      label: 'History unclear',
      short: 'The history does not fully explain this text.',
      long: 'This text was already in the document when the visible history begins (a template, an imported file, a restored version or a copy), or the rebuilt history does not match the current text here.',
    },
    mixed: {
      label: 'Mixed process',
      short: 'Parts of this passage were produced in different ways.',
      long: 'This passage does not fit one pattern. Open it to see each step.',
    },
    provided: {
      label: 'Already in the document',
      short: 'There before the student started: a template, prompt or imported file.',
      long: 'This text was in the document before the visible history begins (a Classroom template, a prompt, an imported file), or was added by an editor marked as Provided. It is set aside: only what students added is coloured.',
    },
    teacher: {
      label: 'Added by the teacher',
      short: 'Written by an editor marked as Teacher.',
      long: 'An editor marked as Teacher added this text. It is set aside: only what students added is coloured.',
    },
  },
  student: {
    linear: { label: 'Written in place', short: 'You wrote this mostly in order and changed it little later.', long: 'You typed this at the end of the paragraph and changed it little afterwards.' },
    light: { label: 'Some revising', short: 'You went back and changed some of this.', long: 'After you first wrote this, you deleted, replaced or added some of it.' },
    heavy: { label: 'Lots of revising', short: 'You rewrote a lot of this.', long: 'You came back and rewrote much of this passage after writing it.' },
    large: { label: 'Added all at once', short: 'This arrived in one large chunk.', long: 'Most of this passage arrived 80 or more characters at a time, as happens when text is pasted, dictated, or inserted by a tool.' },
    pasted: { label: 'Pasted', short: 'The history records this as pasted.', long: 'Google’s history marks most of this passage as pasted in.' },
    unclear: { label: 'History unclear', short: 'The history does not fully explain this text.', long: 'This text was already in the document when the history begins, or the history does not match it.' },
    mixed: { label: 'Mixed', short: 'Parts of this were written in different ways.', long: 'Open the passage to see each step.' },
    provided: { label: 'Already there', short: 'This was in the document before you started.', long: 'This text was already in the document, for example the assignment template.' },
    teacher: { label: 'From your teacher', short: 'Your teacher added this.', long: 'Your teacher added this text.' },
  },
};

export const BADGE_TEXT = {
  insertedThenEdited: 'Inserted in a large chunk, then edited heavily',
  moved: 'Moved or copied from elsewhere in the document',
  removedNear: 'A large block of text was removed next to this',
  suggestion: 'Contains suggested edits',
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
  noPasteMarker: "Google's history does not record pastes directly. Large insertions are shown, but their source (paste, dictation, an extension) is not known.",
  historyStart: 'This document already had text in it when its history begins (a template, a prompt or an imported file). That text is shown in grey as Already in the document, and only what students added is coloured.',
  startProvided: 'This document’s first edit added a block of text at once, as happens when Classroom or “Make a copy” creates it from a template. That starting text is treated as provided: it is grey and not counted as any student’s work.',
  startStudent: 'This document’s first edit added a block of text at once. You chose to count it as the student’s own writing.',
  mismatch: "The rebuilt history does not fully match the document's current text. Paragraphs that do not match are shown as History unclear.",
  unverified: "The rebuilt text could not be checked against Google's copy of the document, so treat the colours with extra care.",
  asOf: (s) => `You are looking at the document as it stood on ${new Date(s.asOf).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Later edits are not shown.`,
  collaborators: () => 'More than one student edited this document. See “Who wrote what”, or colour the document by writer.',
  partial: 'Some edits in this history were not recognised. The colours may be incomplete.',
  evidence: 'This shows how the document was put together. It does not show who wrote it or why, and it is not a finding.',
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

export const ROLE_HELP = 'Mark yourself (or a co-teacher) as Teacher, and anyone whose text was just a starting point as Provided. Only Student text is coloured and counted.';

// The Passage box's before-and-after for a large insertion changed since.
const nWords = (n) => `${n} word${n === 1 ? '' : 's'}`;
export const ORIGINAL_TEXT = {
  title: 'Compared with when it was added',
  first: 'As first added',
  now: 'Now',
  added: (when, n) => `Added at once, ${when} (${n.toLocaleString()} characters in that insertion)`,
  counts: ({ removed, added, kept }) => `Since then: ${nWords(removed)} removed, ${nWords(added)} added, ${nWords(kept)} kept.`,
  key: 'Struck through: words removed since. Underlined: words added since.',
  sentence: 'Shown for the whole sentence this passage sits in.',
};

export const ERRORS = {
  NOT_A_DOC: 'Open a Google Doc first, then click the extension icon.',
  NO_ACCESS: 'You need edit access to this document to see its history. Ask the student to share it with you as an Editor, or open it from Google Classroom.',
  FORMAT_CHANGED: "Google's history format looks different from what this version understands. Turn on testing tools in Settings, save the raw history of one of your own test documents, and report it.",
  NO_HISTORY: 'No editing history was found for this document.',
  FETCH_FAILED: 'The history could not be loaded. Reload the document tab and try again.',
  TAB_CLOSED: 'The document tab was closed or reloaded. Click the extension icon on the document again.',
  ANALYSIS_FAILED: 'The history loaded but could not be analysed. Try Refresh. If it keeps happening, report it with the steps that led to it.',
  ANALYSIS_CRASHED: 'The analysis ran out of memory or stopped unexpectedly on this document. Try Refresh. If it keeps happening, report it.',
  ANALYSIS_STOPPED: 'Analysis stopped. Press Refresh to try again.',
};

export function eventText(ev, actorName) {
  const who = actorName || 'Someone';
  switch (ev.op) {
    case 'ins': return ev.n >= 80 ? `${who} inserted ${ev.n} characters at once` : `${who} typed ${ev.n} character${ev.n === 1 ? '' : 's'}`;
    case 'del': return `${who} deleted ${ev.len} character${ev.len === 1 ? '' : 's'}`;
    case 'sugins': return `${who} suggested ${ev.n} characters`;
    case 'sugdel': return `${who} removed ${ev.len} suggested characters`;
    case 'reset': return `The whole text was replaced (${ev.n} characters)`;
    default: return `${who} made an edit`;
  }
}
