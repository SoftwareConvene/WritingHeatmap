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
  },
  student: {
    linear: { label: 'Written in place', short: 'You wrote this mostly in order and changed it little later.', long: 'You typed this at the end of the paragraph and changed it little afterwards.' },
    light: { label: 'Some revising', short: 'You went back and changed some of this.', long: 'After you first wrote this, you deleted, replaced or added some of it.' },
    heavy: { label: 'Lots of revising', short: 'You rewrote a lot of this.', long: 'You came back and rewrote much of this passage after writing it.' },
    large: { label: 'Added all at once', short: 'This arrived in one large chunk.', long: 'Most of this passage arrived 80 or more characters at a time, as happens when text is pasted, dictated, or inserted by a tool.' },
    pasted: { label: 'Pasted', short: 'The history records this as pasted.', long: 'Google’s history marks most of this passage as pasted in.' },
    unclear: { label: 'History unclear', short: 'The history does not fully explain this text.', long: 'This text was already in the document when the history begins, or the history does not match it.' },
    mixed: { label: 'Mixed', short: 'Parts of this were written in different ways.', long: 'Open the passage to see each step.' },
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
};

export const BANNERS = {
  noPasteMarker: "Google's history does not record pastes directly. Large insertions are shown, but their source (paste, dictation, an extension) is not known.",
  historyStart: 'This document already had text in it when its history begins. That text is shown as History unclear.',
  mismatch: "The rebuilt history does not fully match the document's current text. Paragraphs that do not match are shown as History unclear.",
  unverified: "The rebuilt text could not be checked against Google's copy of the document, so treat the colours with extra care.",
  collaborators: (n) => `${n} people edited this document. Open a passage to see who made each change.`,
  partial: 'Some edits in this history were not recognised. The colours may be incomplete.',
  evidence: 'This shows how the document was put together. It does not show who wrote it or why, and it is not a finding.',
};

export const ERRORS = {
  NOT_A_DOC: 'Open a Google Doc first, then click the extension icon.',
  NO_ACCESS: 'You need edit access to this document to see its history. Ask the student to share it with you as an Editor, or open it from Google Classroom.',
  FORMAT_CHANGED: "Google's history format looks different from what this version understands. Turn on testing tools in Settings, save the raw history of one of your own test documents, and report it.",
  NO_HISTORY: 'No editing history was found for this document.',
  FETCH_FAILED: 'The history could not be loaded. Reload the document tab and try again.',
  TAB_CLOSED: 'The document tab was closed or reloaded. Click the extension icon on the document again.',
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
