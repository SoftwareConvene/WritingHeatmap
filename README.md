<p><img src="extension/icons/icon-128.png" width="48" alt=""></p>

# Writing Heatmap by ClassConvene

See how a Google Doc was written, passage by passage, without replaying the whole history.

Writing Heatmap is a free, open-source Chrome extension for teachers. It reads the edit history Google Docs already keeps and colors the **finished** document by how each sentence got there:

| | Category | What the history shows |
|---|---|---|
| → | **Written straight through** | Typed in order, with few changes afterwards. |
| ✎ | **Some revising** | Partly reworded or rearranged after it was first written. |
| ↻ | **Major revisions** | Largely rewritten after it was first written, or rewritten when the student came back to it later. |
| ⇣ | **Added all at once** | Arrived in big pieces instead of being typed: at least 30 characters at once, and at least three times the size this Doc's typing arrives in (never more than 80). Google does not record whether that was a paste, dictation, another extension or a Google feature. |
| ? | **History unclear** | Already in the document when its history begins (a template, an imported file, a restored version), or the history does not match the text. |
| ≈ | **Mixed** | Parts of the passage were produced in different ways. |

Click any passage to see the exact edits behind it, with times and sizes, and press **▶ Play** to watch just that passage being written. **▶ Play section** beside each heading plays everything under it, and **▶ Play whole document** plays the whole Doc from the first keystroke. When a large insertion (a paste, for example) was changed afterwards, the passage box shows **what it said when it was first added** next to what it says now, with removed words struck through and added words underlined. A summary card, a timeline of writing sessions, a student view, and a printable report are included.

**Typed beside a deleted paste.** A student who pastes text, rewrites it next to the paste and then deletes the paste leaves only typing behind. Passages typed while a paste with many of the same words was in the Doc, where that paste was later deleted, get a dotted underline; click one to see the deleted paste with the shared words highlighted.

**Only the students' work is measured.** Text that was already in the document (a Classroom template, a prompt, an imported file) is shown in gray and set aside, and so is anything you add yourself: the extension recognizes your account, and you can mark any editor as *Teacher* or *Provided*. **Who wrote what** shows each student's share of the final text, how much they typed and deleted, and how much of the provided text they removed. **Compare students** puts every student on one scale: how much they typed, how much arrived in large chunks, how much they deleted, and how their surviving text was written (written straight through, some revising, major revisions, added all at once), in percent and words. Switch the coloring to **Who wrote it** to see each student's text in their own color, or click a name to show only that student's work.

**Time.** Drag the **Document as of** slider to see the document, with its colors, exactly as it stood at any moment. Set your school hours once in Settings and color by **When it was written** to see what was written during the school day, outside it, and (with a due date) after the deadline. **Checkpoints** shows how much each student had written in each section by the dates you pick.

**Class dashboard.** Paste a class's Doc links (optionally with names) and get one sortable table: words, how the text was written, typed vs. added at once, school vs. home, active time, sessions, and a review mark, with CSV download. **Same section in every document** lines up one section (a heading, as in the Doc's table of contents, or the template's own lines such as "Procedure:" when the Docs have no headings) across every student's copy so you can read them one after another without opening each file. Checkpoints work across the class too: click any number to open that student's document at that section as it stood then, or **See in every document** to read that moment across the class.

**Student names.** A link pasted without a label is named after the Doc's student editors as Google lists them, once the Doc is read. Anyone marked Teacher, and anyone who edits most of the class's Docs (a co-teacher), is left out. A Doc no student has written in yet takes the name from its Google Classroom title ("Name - Assignment"). Names are kept only while the dashboard is open, never saved, and never put in a class pack. A label you type yourself is always kept.

**Sharing with a co-teacher.** **Share class pack** saves your dashboards (names, student labels, Doc links, due dates, checkpoints, review marks), editor roles and school hours in one file. Your co-teacher presses **Import class pack** once; send a new pack when something changes and importing it again updates theirs. It never contains student writing: their copy reads the Docs with their own sign-in, so they need edit access too. Tick several sections to read them together. The section list shows the sections most of the class's documents share, so a wrong link or a copy of a different template doesn't clutter it. Open it from the viewer's top bar, or click the extension icon on any tab that isn't a Google Doc.

The view keeps the document's own layout (headings, bold and italic, lists and **tables**), and has **search** and a **Jump to section** list built from the headings.

> **This is not an AI detector and it does not decide who wrote anything.** It describes how a document was put together. The same pattern can come from very different causes: smooth, unrevised typing fits fluent writing and retyping alike, and a large insertion fits a paste, a draft from another app, or voice typing. Use it to start a conversation, not to end one.

## Install (from GitHub)

1. Open the [latest release](https://github.com/softwareconvene/writingheatmap/releases/latest) and download `writing-heatmap-extension-vX.Y.Z.zip`. (Not "Source code".)
2. Unzip it (Windows: right-click → **Extract All**; Mac: double-click). You get a folder named like the zip.
3. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder: the one with `manifest.json` directly inside it.
5. Pin the extension: puzzle-piece icon → pin **Writing Heatmap**.
6. A short **setup guide** opens the first time: school hours, colors and the button in Docs. You can run it again from **Settings**.

If Chrome says *"Manifest file is missing or unreadable"*, the folder you picked doesn't have `manifest.json` directly inside it. Open the folder, find the one that does, and pick that.

To update, download the new zip, replace the folder, and click the reload arrow on the extension's card.

If your school's Chrome does not allow Developer mode, ask IT to allow the extension by its ID (`nkfndgoahhefncdcbolakiobbeopljal`), or wait for the Chrome Web Store listing.

## Use

1. Open a Google Doc you can **edit**. Google only shows edit history to editors; for Classroom assignments, open the student's copy from Classroom after it is turned in.
2. Click the **Writing Heatmap** button (dark, with the logo) in the bottom-left corner of the document, or the extension icon, for a **side panel** beside the Doc with a short summary of each student: how much of their text was added in large chunks, written straight through, retyped or revised. The **↗** beside the button, or **Open the full view** in the panel, opens the full view.
3. A new tab opens, loads the history and shows the heatmap. Long histories take a little longer.

**Google Slides (being tested).** The button and icon also work on a Slides deck, but they don't color it yet. They open a test page that checks whether the deck's history can be read and lets you save it from a practice deck you made yourself (steps in [docs/fixtures.md](docs/fixtures.md#google-slides-being-tested)). The Slides view will be built from that.

## Privacy

- **Everything runs in your browser.** The extension fetches the history from Google using your own sign-in, analyzes it on your computer, and sends nothing to SoftwareConvene or anyone else. There is no server, no account, and no analytics.
- It asks Chrome for `storage`, a side panel, and access to `docs.google.com/document` and `docs.google.com/presentation` (Slides) pages only. It never looks at a document until you click it or press **Analyze all** on a dashboard. The dashboard reads each history with your own sign-in; if Google refuses that, it opens the document in a background tab, reads it, and closes it.
- Saved in this browser only: settings (school hours, editor roles), and for each document or dashboard its due date, checkpoints, names, links and review marks. **No document text or analysis is ever saved to disk.** Settings → Clear local data removes all of it.
- Analyses and your notes are kept **in memory only** (never on disk), expire after an hour by default, and are cleared when Chrome closes or when you press **Settings → Clear local data now**.
- A printed or saved report is part of a student's education record. Store and share it the way your school handles student work.
- Local processing reduces what is shared, but your district may still want to review any extension used with student work. The data flow above is the whole story; please share it with them.

## Limits worth knowing

- Google's fine-grained history format is **undocumented**. Writing Heatmap reads the same history Draftback and similar tools use, and Google can change it at any time. If that happens, the extension says so instead of guessing.
- **Settings → Color-blind friendly colors** switches to a palette that stays distinct for the common kinds of color blindness.
- **Google does not record pastes.** Large insertions are flagged with their size and time, but their source is unknown.
- Voice typing, Smart Compose, Gemini "Help me write", grammar tools and other extensions can all produce large or unusual insertions.
- Text written in another app and pasted in will look like a large insertion even when the student wrote it.
- Shared documents: open a passage to see which editor made each change. Roles you set (Teacher, Provided) are remembered in this browser only.
- Formatting is rebuilt from the history: headings, bold, italic, underline, lists and tables. Images, drawings, comments and colors are not shown.

## For contributors

No dependencies, no build step. Node 20+.

```bash
npm test        # analysis, wording and privacy guards
npm run package # dist/writing-heatmap-extension-vX.Y.Z.zip
```

- `extension/lib/gdocs/` is the only code that knows Google's format. Everything after it works on the vendor-neutral events in `extension/lib/events.js`.
- Thresholds live in `extension/lib/classify.js`; every user-facing sentence lives in `extension/lib/wording.js`.
- Real histories for tests come from test documents, never student work: see [docs/fixtures.md](docs/fixtures.md).
- The research behind the design: [docs/research/](docs/research/).

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE). Contributions are accepted under the [Contributor License Agreement](CLA.md).

Contact: contact@softwareconvene.org
