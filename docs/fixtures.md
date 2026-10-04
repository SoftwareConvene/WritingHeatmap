# Test documents and fixtures

Google's revision history is undocumented. These test documents are how we find out what it really records, and the fixtures made from them keep the extension honest when Google changes something.

**Never use a student's document.** Make each one yourself, in your own Google account, using the marker words below and filler text.

## Making a fixture

1. In the extension: **Settings → Show testing tools**.
2. Make a new Google Doc, named after the recipe (for example `wh-external-paste`), and follow the recipe exactly. Note the time you did each step.
3. Open the Writing Heatmap viewer on it. Scroll to **Feasibility check** in the side panel.
4. Type the recipe name in the box and press **Save raw history for testing**. A `writing-heatmap-raw-….json` file downloads.
5. Scrub and commit it:

   ```bash
   node scripts/scrub-fixture.js ~/Downloads/writing-heatmap-raw-external-paste-….json fixtures/external-paste
   ```

   This replaces account and session ids, drops names, emails and tokens, and refuses to write anything that still looks personal.
6. Open `fixtures/<name>/expect.json` and correct the starter values to what you actually did. `npm test` now checks it.

Marker words are ALPHA, BRAVO, CHARLIE, DELTA, ECHO, FOXTROT, GOLF, HOTEL. Put one at the start of each sentence so the test can find it. Filler: any lorem ipsum.

## Recipes

Each recipe also answers one of the open questions from the [feasibility checklist](#feasibility-checklist).

| Name | Do this | Expected | Answers |
|---|---|---|---|
| `typed` | Type three sentences (ALPHA, BRAVO, CHARLIE) at normal speed. Fix two typos with Backspace. | all *Composed in place* | rebuild works; typed batch sizes |
| `delete-range` | Type `abc`. Select `b`, delete it. | text is `ac` | **does a delete range include its end?** |
| `external-paste` | Type ALPHA. Copy a paragraph starting BRAVO from a web page and paste it. Type CHARLIE. | BRAVO *Large insertion* | **is there any paste marker?** (check the command table) |
| `paste-plain` | Same, but paste with Ctrl/Cmd+Shift+V. | as above | does plain paste differ from rich paste? |
| `internal-paste` | Type ALPHA and BRAVO. Copy ALPHA's sentence and paste it again at the end. | second ALPHA keeps its typed history (badge *Moved or copied*) | copy detection |
| `cut-move` | Type ALPHA, BRAVO, CHARLIE as three paragraphs. Cut BRAVO, paste it after CHARLIE. | BRAVO keeps its typed history (badge) | move detection |
| `rewrite` | Type ALPHA and BRAVO. Wait 35 minutes. Select most of ALPHA and type a new version. | ALPHA *Heavily revised*, BRAVO *Composed in place* | revision credit, sessions |
| `multi-day` | Type ALPHA today, BRAVO tomorrow. | 2 sessions, 2 days | timing |
| `voice` | Tools → Voice typing. Dictate two sentences starting "alpha" and "bravo". | whatever it shows: write it down | how dictation is recorded |
| `smart-compose` | Type ALPHA, accepting Smart Compose suggestions with Tab when offered. | write it down | how accepted suggestions look |
| `gemini` | If available: Help me write → insert a paragraph. Then type BRAVO. | write it down | whether Gemini insertions are marked |
| `grammarly` | With Grammarly on, type ALPHA with mistakes and accept its fixes. | write it down | extension edits |
| `suggestions` | Type ALPHA. Switch to Suggesting; add BRAVO and delete a word of ALPHA. Accept one suggestion, reject the other. | write it down | **suggestion commands** |
| `two-editors` | Share with a second test account. Each types a sentence (ALPHA, BRAVO). | 2 editors | actor ids |
| `imported-docx` | Upload a .docx with ALPHA in it and open it as a Google Doc. Type BRAVO. | ALPHA *History unclear* | history start |
| `classroom-copy` | Make a Classroom assignment with "make a copy for each student" from a template with ALPHA; open the copy as a test student and type BRAVO. | ALPHA *History unclear* | template content |
| `restored` | Type ALPHA, then BRAVO. Restore the version from before BRAVO. Type CHARLIE. | write it down | **`rplc` meaning** |
| `tabs` | Add a second document tab. Type ALPHA in tab 1 and BRAVO in tab 2. | two tabs shown | **tab commands** |
| `long` | An essay of about 1,500 words written over two days. | under 30 seconds to analyze | speed |

## Google Slides (being tested)

Writing Heatmap can't color Slides yet: nobody has published how Slides stores its edit history. One practice deck is enough to find out. Testing tools do not need to be turned on for this.

1. Make a new Google Slides deck in your own account, named `wh-slides-practice`. Note the time of each step.
2. **Slide 1:** in the title box type `ALPHA Planets`. In the body box type a sentence starting `BRAVO`, and fix one typo with Backspace.
3. **Paste:** copy a paragraph from any web page and paste it into the body box on a new line. Then type `CHARLIE` and a few words after it.
4. **Wait at least 35 minutes.** Then edit the pasted paragraph: delete one sentence of it and retype a few of its words.
5. **Slide 2:** add a new slide. Type `DELTA` and a sentence in its title, and `ECHO` and a sentence in its body.
6. **Move and add:** drag slide 2 above slide 1. On the new first slide, Insert → Text box and type `FOXTROT` and a sentence.
7. Click the **Writing Heatmap** button (bottom-left) or the toolbar icon. A **Google Slides: testing** page opens.
8. Type `slides-practice` in the name box and press **Save raw history for testing**. Send the downloaded `writing-heatmap-raw-slides-practice-….json` file, with your step times.

If the page says the history can't be read, save anyway: the file records what Google answered to each request, and that is what's needed next.

## Feasibility checklist

The first test session decides whether the approach holds up (go/no-go). The panel fills in what it can; the rest is read from the fixtures above.

1. The history loads with your normal sign-in, with no extra Google permission. *(panel)*
2. The last revision from Google's tile list matches the probed last revision. *(panel)*
3. The rebuilt text matches Google's copy for `typed`, `external-paste`, `cut-move`, `multi-day`, `two-editors` and `tabs`. Anything else either matches or is shown as History unclear, never silently wrong. *(panel)*
4. Whether delete ranges include their end. *(`delete-range`, panel row 4)*
5. Timestamps are in milliseconds and typed batches are small. *(panel)*
6. Whether Google records pastes at all. *(`external-paste`, `paste-plain`: look for a command type or field that appears only there)*
7. How suggestions, tabs and version restores are encoded. *(`suggestions`, `tabs`, `restored`)*
8. A long essay analyzes in under 30 seconds. *(`long`, panel)*
9. DevTools → Network shows requests only to `docs.google.com`.

**No-go** if 1 fails on every URL variant, or a plain typed document cannot be rebuilt.

Record the answers in `docs/research/phase0-findings.md`.
