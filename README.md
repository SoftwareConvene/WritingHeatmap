<p><img src="extension/icons/icon-128.png" width="48" alt=""></p>

# Writing Heatmap by ClassConvene

See how a Google Doc was written, passage by passage, without replaying the whole history.

Writing Heatmap is a free, open-source Chrome extension for teachers. It reads the edit history Google Docs already keeps and colours the **finished** document by how each sentence got there:

| | Category | What the history shows |
|---|---|---|
| → | **Composed in place** | Typed at the end of its paragraph and changed little afterwards. |
| ✎ | **Lightly revised** | Some deleting, replacing or rearranging after it was first written. |
| ↻ | **Heavily revised** | Substantial rewriting, or the writer came back to it after moving on. |
| ⇣ | **Large insertion** | Arrived 80+ characters at a time. Google does not record whether that was a paste, dictation, another extension or a Google feature. |
| ? | **History unclear** | Already in the document when its history begins (a template, an imported file, a restored version), or the history does not match the text. |
| ≈ | **Mixed process** | Parts of the passage were produced in different ways. |

Click any passage to see the exact edits behind it, with times and sizes, and to **replay just that passage** instead of the whole document. A summary card, a timeline of writing sessions, a student view, and a printable report are included.

> **This is not an AI detector and it does not decide who wrote anything.** It describes how a document was put together. The same pattern can come from very different causes: smooth, unrevised typing fits fluent writing and retyping alike, and a large insertion fits a paste, a draft from another app, or voice typing. Use it to start a conversation, not to end one.

## Install (from GitHub)

1. Open the [latest release](https://github.com/softwareconvene/writingheatmap/releases/latest) and download `writing-heatmap-extension-vX.Y.Z.zip`. (Not "Source code".)
2. Unzip it (Windows: right-click → **Extract All**; Mac: double-click). You get a folder named like the zip.
3. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder: the one with `manifest.json` directly inside it.
5. Pin the extension: puzzle-piece icon → pin **Writing Heatmap**.

If Chrome says *"Manifest file is missing or unreadable"*, the folder you picked doesn't have `manifest.json` directly inside it. Open the folder, find the one that does, and pick that.

To update, download the new zip, replace the folder, and click the reload arrow on the extension's card.

If your school's Chrome does not allow Developer mode, ask IT to allow the extension by its ID (`nkfndgoahhefncdcbolakiobbeopljal`), or wait for the Chrome Web Store listing.

## Use

1. Open a Google Doc you can **edit**. Google only shows edit history to editors; for Classroom assignments, open the student's copy from Classroom after it is turned in.
2. Click the extension icon, or the green **Writing Heatmap** button in the bottom-left corner of the document.
3. A new tab opens, loads the history and shows the heatmap. Long histories take a little longer.

## Privacy

- **Everything runs in your browser.** The extension fetches the history from Google using your own sign-in, analyses it on your computer, and sends nothing to SoftwareConvene or anyone else. There is no server, no account, and no analytics.
- It asks Chrome for one permission, `storage`, and runs only on `docs.google.com/document` pages. It never looks at a document until you click it.
- Analyses and your notes are kept **in memory only** (never on disk), expire after an hour by default, and are cleared when Chrome closes or when you press **Settings → Clear local data now**.
- A printed or saved report is part of a student's education record. Store and share it the way your school handles student work.
- Local processing reduces what is shared, but your district may still want to review any extension used with student work. The data flow above is the whole story; please share it with them.

## Limits worth knowing

- Google's fine-grained history format is **undocumented**. Writing Heatmap reads the same history Draftback and similar tools use, and Google can change it at any time. If that happens, the extension says so instead of guessing.
- **Google does not record pastes.** Large insertions are flagged with their size and time, but their source is unknown.
- Voice typing, Smart Compose, Gemini "Help me write", grammar tools and other extensions can all produce large or unusual insertions.
- Text written in another app and pasted in will look like a large insertion even when the student wrote it.
- Shared documents: open a passage to see which editor made each change.

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
