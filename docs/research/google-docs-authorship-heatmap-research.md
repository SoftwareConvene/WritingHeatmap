# Research Report: A Local-First Google Docs Writing-Process Heatmap for Teachers

**Prepared:** October 2026  
**Product concept:** A free, open-source Chrome extension that overlays a finished Google Doc with passage-level evidence about *how each passage was produced*—for example pasted, composed linearly, lightly revised, or heavily revised—with click-through replay for any passage.

> **Bottom line:** The concept is technically plausible and differentiated, but it should be built as a **writing-process evidence viewer, not an AI detector**. The most defensible MVP is a local-only passage heatmap plus event-level evidence, replay, and class triage. The largest technical risk is dependence on Google Docs' undocumented fine-grained revision endpoint; the largest product risk is turning normal variation in writing behavior into a de facto cheating score.

---

## Executive recommendation

Build the extension, but narrow the promise:

- **Do promise:** "See how this document was constructed, passage by passage."
- **Do not promise:** "Detect whether this was written by AI" or "prove authorship."
- **Treat direct observations as stronger than inferences.** A recorded paste event is evidence that text was pasted. Heavy revision is evidence of revision. Neither tells you *why* the writer acted that way.
- **Keep the default analysis local in the teacher's browser.** This substantially reduces privacy and compliance exposure, but it does **not automatically eliminate school/district approval or DPA requirements**; local processing changes the data-flow facts, while district policy and state law still govern adoption.
- **Make the final document the primary navigation surface.** The heatmap is your strongest differentiation from replay-first tools: teachers should be able to scan 1,500 words in seconds, click one questionable or interesting passage, and replay only the relevant history.
- **Do not ship a “retyped/transcribed” accusation in the MVP.** Recent research shows copy-typing can sometimes be distinguished from natural composition using true keystroke logs, but Google Docs retrospective revision data are not equivalent to raw keydown/keyup telemetry, and performance is not strong enough to turn into a student-facing verdict without substantial validation.

The research case for this positioning is strong. Google itself says version history requires edit permission and may merge revisions; the public Drive API warns that revision lists can be incomplete, while Draftback explains that it instead uses the fine-grained updates Google Docs keeps for collaboration ([Google Docs Help](https://support.google.com/docs/answer/190843), [Drive revisions documentation](https://developers.google.com/workspace/drive/api/guides/manage-revisions), [Draftback](https://draftback.com/)).

---

# 1. Competitive landscape

## 1.1 The market has split into three product types

### A. Retrospective Google Docs history readers

These products inspect history Google already recorded, so the student generally does **not** need to install the tool while writing.

#### Draftback

**What it does.** Draftback replays a Google Doc's writing history as a movie, provides a document summary, and works retroactively on documents whose history already exists. Draftback states that it does not literally record every keystroke; it uses the fine-grained incremental updates that Google Docs maintains for real-time collaboration. It currently says it has more than 500,000 users ([Draftback](https://draftback.com/)).

**Price.** As of 2026, Draftback lists $100/year regular pricing and a teacher price of $40/year; monthly plans are also available ([Draftback pricing](https://draftback.com/)).

**Data/presentation.** Its core presentation remains replay-first: watch the document evolve, pause, rewind, and inspect a summary. It is strongest for a deep investigation of one document and weakest for fast spatial scanning of a finished essay.

**Privacy.** Draftback says document content and revision data stay local in the browser; its remote service is used for subscription/trial management after user consent ([Draftback privacy explanation](https://draftback.com/)).

**Known limits.** It requires **edit permission** to the document. Its reliance on internal Docs behavior has produced breakage in the past; a public GitHub issue from 2017 documents failures when Google account URL routing changed and the extension's `Changelog`/`RevisionCount` URL assumptions stopped working ([GitHub issue](https://github.com/jsomers/draftback/issues/2)). The current product has been updated through 2026, so this is evidence of maintenance risk rather than evidence that the present version is broken.

**Teacher reaction.** The enduring praise is that replay is much more persuasive than an opaque AI score. The recurring complaint is exactly the problem motivating your product: replay is time-consuming. Recent teacher discussions also note that a student can defeat the naive "typed = authentic" assumption by retyping externally generated text or using automation that simulates human typing ([Teachers discussion](https://www.reddit.com/r/Teachers/comments/1hp8pru/)).

**Recommendation for your product:** Copy the *click-through replay* concept, not the replay-first workflow.

---

#### Revision History (revisionhistory.com)

**What it does.** Revision History overlays a toolbar on Google Docs and Slides, gives summary statistics, tracks copy/paste events, offers playback, flags unusual patterns, provides user-contribution breakdowns, and supports downloadable PDF reports. Its site says it can distinguish content pasted from an external source versus content moved/copied within the document ([Revision History](https://www.revisionhistory.com/)).

**Price.** The current free plan allows up to 150 documents/month; Plus is $32/year when billed annually ([Revision History pricing](https://www.revisionhistory.com/)).

**Data/presentation.** It is notably more scan-friendly than Draftback: teachers see active writing time, paste counts, and unusual-writing flags before deciding whether to replay.

**Known limits.** It still fundamentally presents **document-level summary + replay**, rather than mapping provenance/revision intensity directly onto the final prose. Its FAQ explicitly says it does not prove AI use and frames the data as evidence for a conversation ([Revision History welcome/FAQ](https://www.revisionhistory.com/welcome)).

**Teacher reaction.** Teachers praise the nonintrusive top bar and the speed of seeing active time and paste counts. One widely shared teacher post described the summary toolbar as a much faster alternative to clicking through timestamps manually ([Reddit teacher thread](https://www.reddit.com/r/Teachers/comments/1gdng4j)). A 2026 teacher complaint illustrates a predictable monetization pain point: opening many Docs quickly reaches the free tier's document limit ([Reddit Google Docs thread](https://www.reddit.com/r/googledocs/comments/1so7fp3/revision_history/)).

**Recommendation:** This is the closest direct competitor to your intended teacher workflow. Your feature must make the passage heatmap visibly faster than its toolbar + replay model.

---

#### Brisk Teaching — Inspect Writing

**What it does.** Inspect Writing replays a student's Google Docs or OneDrive Word writing process. In the current Google Docs UI, green indicates created text, yellow indicates large copy/paste actions, and red indicates deletions ([Brisk Inspect Writing help](https://help.briskteaching.com/hc/en-us/articles/39310227756436-How-To-Inspect-Writing)). Brisk emphasizes that it does not output an “accuracy score”; it presents the factual record and recommends using it to start an academic-integrity conversation ([Brisk Inspect Writing](https://www.briskteaching.com/inspect-writing)).

**Price.** Brisk has a free educator tier; premium school/district functionality is institutionally priced ([Brisk FAQ](https://www.briskteaching.com/faq)).

**Data/presentation.** Replay with color-coded edit types. Brisk is broader than your concept—it bundles many AI-assisted teacher tools—so Inspect Writing is a feature rather than the whole product.

**Known limits.** Replay remains sequential. It does not appear to expose a stable passage-level final-text provenance map comparable to your proposed heatmap.

**Recommendation:** Match the simple event colors, but make the teacher start from the *finished text* and drill backward.

---

#### GPTZero Origin / Google Docs Writing Report

**What it does.** Origin provides a writing replay plus a report that evaluates whether the writing pattern appears human-written ([GPTZero support](https://support.gptzero.me/articles/7001890416-what-is-the-google-docs-writing-report-for-origin)). GPTZero's broader educator product also supports batch document scanning and AI-text detection ([GPTZero educator tools](https://support.gptzero.me/articles/4015842900-what-products-do-you-have-for-educators)).

**Price.** GPTZero has a free tier and paid plans; current self-serve pricing changes frequently, so the product should be treated as freemium rather than relying on one fixed number. GPTZero's educator page currently advertises premium benefits valued at $288/year in its ambassador program ([GPTZero educators](https://gptzero.me/educators)).

**Data/presentation.** Replay plus process-level interpretation, combined with GPTZero's conventional text classifier.

**Known limits.** It inherits the central problem of AI detectors: process history can strengthen evidence, but an overall “human-written” interpretation can be mistaken for a verdict. Teachers discussing these tools frequently prefer raw history evidence to an AI score because the latter is difficult to defend to students or parents ([teacher discussion](https://www.reddit.com/r/Teachers/comments/1nl51sq/what_ai_checker_do_you_use/)).

**Recommendation:** Avoid combining your heatmap with a generic AI classifier in the MVP. It weakens your evidentiary positioning.

---

#### Process Feedback

**What it does.** Process Feedback is now a significant direct competitor: its Google Docs extension turns existing edit history into a report showing writing time, revision effort, copy/paste events, breaks, author contributions, replay, PDF export, and a whole-class dashboard ([Process Feedback extension](https://processfeedback.org/gdocs/), [Chrome Web Store description](https://chromewebstore.google.com/publisher/process-feedback/ue8d34ea7c14ae4e3d29178e8eadfce5e)).

**Price.** Core individual teacher/student use is free. 2026 institutional pricing starts at $200/year for one school for its lowest local-extension tier, with higher support/compliance tiers and custom district pricing ([institutional pricing](https://processfeedback.org/institutional-pricing/)).

**Architecture.** This competitor is especially important because it independently validates your local-first model. It says the extension requests a document's writing-process data from Google using the user's existing Google sign-in, stores it in local browser storage, and generates the report in-browser; data leave the device only when the user explicitly chooses to share a report ([architecture explanation](https://processfeedback.org/docs/how-gdocs-extension-works/)). It even publishes a network-audit procedure for institutions to verify local processing ([verification guide](https://processfeedback.org/docs/google-docs-verification-guide/)).

**Known limits.** It has process charts and dashboards but still does not make the final document itself the primary passage-level provenance visualization.

**Recommendation:** This is the competitor to study most closely for privacy architecture, teacher dashboards, and fair wording. Your heatmap is the primary remaining UX wedge.

---

### B. Prospective provenance capture

These products capture richer information *while the student writes*. That can identify clipboard or browsing provenance more precisely, but it requires student-side installation/use and changes the privacy and deployment model.

#### Grammarly Authorship

**What it does.** Authorship tracks where text came from and displays snapshot analytics, a granular color-coded report over the submitted text, and full replay. Grammarly explicitly markets a source-level view showing text categorized as student-written, AI-generated, or copied ([Grammarly Authorship](https://www.grammarly.com/edu/authorship)). It works in Google Docs and Microsoft Word and can track writing activity across browser tabs.

**Price.** Individual Grammarly users can access Authorship in supported plans; institutional Grammarly for Education is contract-priced. As a public price reference, AWS Marketplace lists $5,000/year for 50 education seats and $25,000/year for 1,000 seats, although negotiated education contracts can differ ([AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-pre3ueh3h2gza)).

**Why it matters.** Grammarly is the strongest proof that **final-text source coloring is useful and understandable**. But its architecture differs from yours: it is present during writing, so it can observe clipboard/browser context that retrospective Docs history may not preserve.

**Known limits.** Student-side instrumentation is a deployment and trust burden. Its “AI-generated” categories depend on what Grammarly can observe or label, not omniscience about all AI usage.

**Recommendation:** Treat Authorship as validation of the heatmap interaction, but keep your labels about **observable process** rather than asserting the semantic source of every word.

---

#### Cursive (now associated with Blackboard)

**What it does.** Cursive records process data and applies keystroke-dynamics/authorship models. Its public writing report includes authorship confidence, effort, time spent, typing speed, and word count ([Cursive writing report](https://cursivetechnology.com/my-writing-report/)). It states that it captures richer data than Google revision history and uses typing behavior as a biometric signal ([Cursive process description](https://cursivetechnology.com/trust-the-writing-process/)). Blackboard announced Cursive in its portfolio in September 2026 ([Blackboard announcement](https://www.blackboard.com/news/blackboard-introduces-cursive-bringing-transparent-authorship-verification-to-every-lms)).

**Price.** Moodle process tracking is advertised free; school Starter and Enterprise tiers are quote-based ([Cursive pricing](https://cursivetechnology.com/)).

**Data/presentation.** Dashboard-style process analytics and an authorship-verification layer rather than only reconstruction of document history.

**Known limits.** Biometric authorship is materially more sensitive than your proposed retrospective visualization. The research literature shows keystroke biometrics can be useful, but false rejections still exist and performance varies with environment, task, length, keyboard, and writer condition ([Ahmed & Traore, 2014](https://pubmed.ncbi.nlm.nih.gov/23757560/)).

**Recommendation:** Do not turn your extension into a behavioral-biometric identity product unless you are willing to accept a much larger validation, privacy, disability, and procurement burden.

---

### C. Controlled writing environments

#### Turnitin Clarity

**What it does.** Clarity is a dedicated Turnitin writing space. Students compose inside Clarity, and instructors receive a Writing Report showing process data. Turnitin says it captures insertions, deletions, revisions, clipboard paste, copy/cut events, and activity used to construct version history ([student FAQ](https://guides.turnitin.com/hc/en-us/articles/36983230792461-FAQs-for-students-using-Turnitin-Clarity)).

**Price.** Clarity is an additional paid add-on to Turnitin Feedback Studio; pricing is quote-only ([administrator FAQ](https://guides.turnitin.com/hc/en-us/articles/37670935742989-FAQs-for-administrators-using-Turnitin-Clarity)).

**Data/presentation.** Because Turnitin owns the editor, it can record richer and more reliable process telemetry than a retrospective Google Docs reader.

**Known limits.** The student must write inside the Clarity environment. This is the opposite of your low-friction design goal.

**Recommendation:** Use Clarity as a benchmark for event semantics and report design, not as an architectural model.

---

### D. Google Docs built-in version history

Google Docs natively lets editors inspect prior versions and see which collaborator made changes. Google explicitly says a user needs **edit permission** to browse version history, and revisions may occasionally be merged ([Google Docs Help](https://support.google.com/docs/answer/190843)). Education Plus can also show editors for a selected passage, but this is contributor attribution, not process classification.

**Gap:** Google's UI is version-oriented, not investigation-oriented. It does not give paste counts, active-writing time, passage provenance categories, process metrics, or class-level triage.

---

## 1.2 Open-source projects worth studying

1. **Harvard VPAL `gdocrevisions` — MIT license.** A Python package for retrieving and processing Google Doc revision history; useful as a parser/reference implementation ([GitHub](https://github.com/harvard-vpal/gdocrevisions)).
2. **Draftback public repository.** Old code and issues are useful historical documentation of Google Docs internal-history behavior, but the current commercial extension has evolved beyond this repository ([GitHub](https://github.com/jsomers/draftback)).
3. **Writing Observer / ArgLab.** Research-oriented writing process infrastructure has existed under AGPL-family licensing; treat AGPL code as code you can use only if you are comfortable with its reciprocal obligations, not as snippets to transplant into an MIT project.
4. **CyWrite / ProWrite research tooling.** Academic systems have logged keystrokes, pauses, revision and eye gaze and rendered process visualizations; they support the validity of the interaction model even though they are not drop-in Google Docs extensions ([Frontiers ProWrite paper](https://www.frontiersin.org/journals/communication/articles/10.3389/fcomm.2022.933878/full)).

A useful 2026 independent engineering synthesis also documents the current internal `revisions/load` route and compares the retrospective model with live capture; because it is a third-party reverse-engineering note, use it as a lead to reproduce experimentally rather than as a platform guarantee ([HumanshipD research note](https://github.com/Flagrare/humanshipd/blob/main/docs/research/2026-06-06-google-docs-writing-capture.md)).

---

## 1.3 Gap no current tool fully fills

The clearest unfilled gap is:

> **A trustworthy, passage-level process map of the finished document that lets a teacher scan first and replay second.**

Grammarly comes closest visually, but it is a prospective student-side instrumentation product. Revision History and Process Feedback come closest in retrospective Google Docs analysis, but their core reports are still summary/timeline/replay-oriented.

The opportunity is therefore not “better AI detection.” It is **better information architecture for revision-history evidence.**

---

# 2. Google Docs data access and feasibility

## 2.1 How Draftback-like tools obtain fine-grained history

Draftback's own explanation says it uses the fine-grained incremental updates Google Docs stores to make real-time collaboration work, rather than the coarse named versions visible in the normal UI ([Draftback](https://draftback.com/)). Historical Draftback code/issues refer to internal `Changelog` and `RevisionCount` endpoints, and newer reverse-engineering identifies a Google-internal `revisions/load` request ([Draftback issue](https://github.com/jsomers/draftback/issues/2), [2026 engineering note](https://github.com/Flagrare/humanshipd/blob/main/docs/research/2026-06-06-google-docs-writing-capture.md)).

### Feasibility judgment

**Technically feasible: high.** Multiple current products prove it can be done.

**API stability: medium-to-low.** The endpoint is undocumented. Google can change URL structure, authentication tokens, response schema, batching, or editor architecture without notice. The historical Draftback outage around multi-account URL changes is exactly the maintenance class to expect.

**Policy stability: uncertain.** Chrome Web Store policy requires narrow permissions, disclosure, consent, and transparent handling of website/user-generated content ([Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)). I found no public Google policy stating that `revisions/load` is a supported third-party interface. An extension that uses the current user's authenticated same-origin Google Docs session therefore carries more review/maintenance uncertainty than one built only on documented APIs.

**Recommendation:** Treat the internal Google Docs adapter as a replaceable module behind a stable internal event schema. Do not let your UI or scoring logic depend directly on Google's current command names.

---

## 2.2 Public Drive API revisions

The Drive API exposes a `revisions` resource, but Google explicitly warns that:

- the list may be **incomplete for heavily edited Google Docs**;
- older revisions may be omitted;
- editor revisions may be **merged together**;
- the Drive API's revision history can be less complete than the UI ([Manage revisions](https://developers.google.com/workspace/drive/api/guides/manage-revisions), [changes/revisions overview](https://developers.google.com/workspace/drive/api/guides/change-overview)).

The revision object is also metadata/snapshot oriented—ID, modified time, last modifying user, export links, and related fields—not a keystroke/event log ([Revision resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions)).

**Conclusion:** Public Drive revisions are not sufficient for your heatmap.

---

## 2.3 Google Docs API

The Docs API is designed to retrieve document structure and create/modify document content; it does not expose a historical stream of fine-grained edits ([Docs API overview](https://developers.google.com/workspace/docs/api/how-tos/overview)).

**Conclusion:** It can help interpret the *current* document structure, but it cannot reconstruct the detailed process by itself.

---

## 2.4 OAuth and Chrome Web Store implications

If the extension can do its analysis as a content script inside an already-open Google Doc, using the teacher's existing Docs session, you may be able to avoid broad Drive OAuth scopes. That is attractive because Google classifies `drive` and `drive.readonly` as **restricted** scopes; restricted-scope use requires enhanced verification, and if restricted data are transmitted to or stored on a third-party server an annual security assessment may be required ([Drive OAuth scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)). `drive.file` is narrower/non-sensitive, but it only grants app-specific/per-file access and does not solve the lack of fine-grained history.

Chrome Web Store policy requires that extensions:

- request the narrowest permissions necessary;
- disclose what user data are handled and why;
- get informed consent;
- limit data use to the stated single purpose;
- secure user-generated content and browsing/webpage data ([Chrome policies](https://developer.chrome.com/docs/webstore/program-policies/policies)).

Manifest V3 also increases the importance of shipping executable logic inside the extension rather than loading remote code at runtime. Design your parser/classifier so rule updates are data/configuration where possible, not remotely executed JavaScript.

### Recommendation

For the MVP, prefer:

- host permission limited to `https://docs.google.com/document/*`;
- no broad Drive OAuth scope;
- no backend;
- no analytics that include document IDs, document text, student names, or revision payloads;
- explicit user action (“Analyze writing process”) rather than background scanning every Doc.

This is not a guarantee of Chrome Web Store approval, but it is the lowest-risk posture consistent with the product.

---

## 2.5 What permission does a teacher need?

Google says version history requires **edit permission** ([Google Docs Help](https://support.google.com/docs/answer/190843)). Draftback and Revision History say the same ([Draftback](https://draftback.com/), [Revision History FAQ](https://www.revisionhistory.com/welcome)).

### Classroom “make a copy for each student”

Google Classroom's documented workflow gives teachers access to student copies while students work; teachers can view progress, comment, and edit. Once a student turns in a Google file, the teacher has edit access and the student temporarily loses edit access until return ([Classroom attachment workflow](https://support.google.com/edu/classroom/answer/6020260)). This is the cleanest deployment path.

### Student shares an existing Doc

The student must share the file with the teacher as **Editor**, not Viewer or Commenter, if the teacher needs version history. Merely being able to read the final document is insufficient.

### Teacher makes a copy of a student's file

A newly made copy does **not** reliably preserve the original file's complete process history as the evidentiary object you want. The analysis should be run on the original student-authored Doc, not a teacher-created copy made after submission.

---

## 2.6 Can paste source be distinguished?

Revision History currently claims it can distinguish external pastes from content copied within the document ([Revision History](https://www.revisionhistory.com/)). That is encouraging but should not be treated as a stable Google guarantee.

For your product, define three confidence levels:

1. **Direct paste marker/source available** — strong evidence.
2. **Large atomic insertion consistent with paste** — inference only.
3. **Ordinary insertion stream** — no paste evidence, not proof of manual composition.

Before shipping, build a fixture suite that tests:

- Ctrl/Cmd-V from a website;
- paste from another Google Doc;
- copy/paste within the same Doc;
- drag/move text;
- cut/paste;
- paste without formatting;
- browser context-menu paste.

Do not promise source classification until those behaviors have been reproduced across Chrome versions and Google Workspace accounts.

---

## 2.7 Special input modes that can confuse provenance

These are precisely where a “heatmap = cheating map” design becomes unsafe.

### Voice typing

Google Docs supports native voice typing and voice edit commands ([Google Docs Voice Typing](https://support.google.com/docs/answer/4492226)). Retrospective edit history may show rapid text insertion with little keyboard-like cadence. Unless Google exposes an explicit operation source in the history payload, label this **“rapid insertion / source unknown”**, not paste or AI.

### Grammarly and other extensions

Extensions can rewrite, replace, or insert text programmatically. Depending on how Docs records the operation, these may resemble large insertion/replacement events. If you cannot directly identify the actor/source, show the operation, not a semantic claim about its origin.

### Autocorrect and Smart Compose

Smart Compose lets a user accept an offered completion with Tab/right-arrow ([Google Smart Compose](https://support.google.com/docs/answer/9643962)). This can cause several characters to appear with a single user action. It should not count as a paste. More generally, low-level history is not the same as a keydown log.

### Gemini “Help me write”

This is an especially important unresolved test case. If Gemini inserts content through Google Docs' own editing machinery, the revision stream may encode a large insertion but not expose the semantic fact “Gemini generated this.” Do not infer Gemini use unless the event payload explicitly preserves that provenance and you have independently tested it.

### Suggestion mode

Suggestions are structured edits rather than ordinary final-text insertions. Your parser needs to decide whether to attribute a final passage to the student author, suggester, or accepter. The safest UI is to show collaborator/source contribution separately from process category.

### Imported `.docx`

A document imported into Google Docs can begin with a large body of preexisting text. That is not evidence that the student pasted or generated it. Detect document-age/import patterns where possible and surface an **“history begins with existing content”** banner.

---

# 3. What teachers actually want to see

The teacher discussions and current products converge on a small set of useful process signals:

1. **Large paste events and where they landed.** This is repeatedly cited as the fastest useful signal because a full essay appearing at once creates a concrete question to ask. Teachers also recognize the legitimate explanation “I drafted elsewhere,” so it is evidence, not proof ([teacher thread](https://www.reddit.com/r/Teachers/comments/1swf0yb/using_google_docs_to_prevent_ai_use_on_essays/)).
2. **Active writing time.** Revision History prominently exposes it, and teachers specifically praise not having to infer duration from raw timestamps ([teacher discussion](https://www.reddit.com/r/Teachers/comments/1gdng4j)).
3. **Number of sessions / active days.** A paper built over several sessions is pedagogically useful information even when academic integrity is not in question.
4. **Revision amount and location.** Teachers care whether revision affected ideas/structure or only surface mechanics.
5. **Deleted/replaced text.** It makes thinking visible and can support instruction, not merely investigation.
6. **Order of composition.** Writing paragraphs out of order is normal for some writers and useful to visualize. It becomes especially informative when paired with paste/revision evidence.
7. **Contributor identity.** In shared documents, which author made which changes matters.
8. **Passage-level replay.** Teachers want to inspect the suspicious or pedagogically interesting passage without watching the entire document.

## Signals that are easy to overinterpret

### Typing speed

Words per minute is highly dependent on keyboarding skill, device, disability/accessibility tools, age, language proficiency, and task difficulty. It is a poor standalone authorship signal.

### Total time

“30 minutes” can mean focused work, an outline prepared elsewhere, transcription from paper, or a strong writer producing a short response. Treat time as context.

### Few revisions

Strong writers sometimes plan extensively before typing; some students draft on paper; some produce clean first drafts. A low revision count is not misconduct evidence.

### Lots of pauses

Second-language writing research shows pausing behavior varies by language proficiency and task, and the same pause duration can reflect planning, rereading, lexical search, distraction, or revision. Keystroke logs alone do not reveal the cognitive cause ([Barkaoui 2019](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/abs/what-can-l2-writers-pausing-behavior-tell-us-about-their-l2-writing-processes/BA790529729B7CD2151217EB97B78D1E), [Révész et al. 2019](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/exploring-second-language-writers-pausing-and-revision-behaviors/A84135AD35874EDEDF50D8BD6D36B911)).

---

## 3.1 What makes evidence persuasive and fair in a conversation

The strongest report is **specific, replayable, and non-conclusive**:

> “This paragraph entered the document as a 612-character paste at 9:14 PM, then 18 characters were edited over the next four minutes. Can you walk me through where the pasted text came from and how you developed it?”

That is far more defensible than:

> “The tool says this paragraph is 82% AI.”

A good report therefore needs:

- exact timestamps;
- passage location;
- event type and size;
- uncertainty labels;
- replay from immediately before the event;
- author/collaborator identity where available;
- a note about known alternate explanations;
- no automatic disciplinary conclusion.

---

## 3.2 Class-level triage

A class dashboard should answer **“which documents deserve a closer look?”**, not “who cheated?”

Recommended sortable columns:

- student/document name;
- final word count;
- active writing time;
- active sessions / days;
- % of final text with direct paste provenance;
- largest paste span;
- % heavily revised;
- % history-unknown / imported;
- collaborator count;
- unusual-event count (descriptive only);
- status: not reviewed / reviewed / discussed.

Avoid a single red “risk score.” It invites overreliance and destroys the advantage of an evidence-first product.

---

# 4. Process signals and heatmap definitions

## 4.1 Research basis

Keystroke-logging research commonly analyzes:

- **pauses**;
- **P-bursts**: production runs terminated by a pause;
- **R-bursts**: production runs terminated by revision;
- deletion/insertion frequency;
- revision distance and scope;
- linear versus post-context revision.

A 2-second threshold is widely used to separate fluent production from longer planning interruptions when defining P-bursts, although research uses multiple thresholds depending on the question ([2026 Journal of Second Language Writing study](https://www.sciencedirect.com/science/article/pii/S1060374325001018)). Inputlog itself allows user-defined pause thresholds and reports pause and revision bursts ([Inputlog overview](https://www.researchgate.net/publication/243971626_Keystroke_Logging_in_Writing_Research_Using_Inputlog_to_Analyze_and_Visualize_Writing_Processes)).

Important limitation: these studies usually use **true keystroke logs**. Google Docs retrospective mutation history is fine-grained but still may batch edits. Therefore, your extension can borrow the concepts but should not pretend to have millisecond key-event fidelity unless you actually capture it live.

---

## 4.2 Recommended internal event model

Normalize Google's current history into a vendor-independent model:

```text
EditEvent
- event_id
- timestamp_start
- timestamp_end (if known)
- actor_id
- operation: insert | delete | replace | move | format | comment | unknown
- document_position_before
- document_position_after
- text_inserted
- text_deleted
- source_hint: paste_external | paste_internal | voice | suggestion | unknown
- source_confidence: direct | inferred | unknown
- revision_id / raw_event_pointer
```

Then reconstruct **lineage** for every surviving character/span in the final document. The heatmap should classify final spans from that lineage, not by simply coloring chronological events.

---

## 4.3 Passage unit

Use a **sentence as the default display unit**, but compute metrics on smaller lineage spans.

Why:

- word-level coloring is visually noisy;
- paragraph-level coloring hides mixed provenance;
- sentence-level is understandable in a teacher conversation;
- clicking a sentence can still reveal the underlying spans and events.

If one sentence contains materially different process histories, split it into contiguous sub-spans of at least **20 characters**; merge smaller spans into the dominant neighboring category while preserving exact detail in the inspector.

---

## 4.4 Core metrics

For final passage `p`:

### Paste share

`paste_share = surviving characters with direct paste provenance / final characters`

Keep **direct** and **inferred** paste separate.

### Revision load

`revision_load = (characters deleted from passage lineage + characters inserted into existing passage after initial production) / max(final characters, 1)`

Cap only for display; do not cap raw value because a 100-character sentence can legitimately accumulate 300 characters of deleted/replaced text.

### Post-context revision share

`post_context_revision_share = revised surviving characters edited after the writer had advanced >= 100 characters beyond that location / final characters`

This distinguishes immediate typo correction from returning later to restructure earlier prose.

### Production linearity

`linearity = characters initially produced at or near the current document frontier / all initially produced characters`

Use a frontier tolerance of **±20 characters** to avoid treating punctuation/cursor corrections as nonlinear composition.

### Session count

A new session begins after **>= 30 minutes with no recorded text operation**. Show 30 minutes as a configurable analytic convention, not a psychological fact.

### Active writing time

Sum periods containing edit activity, excluding idle gaps over **2 minutes**. Again, clearly label this an estimate.

### Large insertion

An insertion should be called “large” when either:

- direct paste metadata identifies it; or
- an atomic/batched insertion adds **>= 80 characters** with no equivalent preceding deletion and source is unknown.

The second case must be labeled **“large insertion; source unknown,”** never “paste.”

---

## 4.5 Recommended MVP heatmap categories

Use categorical colors rather than a red-to-green “good/bad” gradient.

### 1. **Pasted / transferred**

**Definition:** At least **60%** of the displayed passage's surviving characters have **direct** paste provenance, or the passage is dominated by a single directly identified paste span of >= 80 characters.

**Display wording:** “Transferred into document” with source detail such as “external clipboard” only when directly observed.

**Why 60%:** It avoids coloring an otherwise hand-composed sentence as pasted because of one quoted phrase or citation.

### 2. **Composed linearly**

**Definition:**

- direct paste share < 10%;
- revision load < 0.10;
- post-context revision share < 0.05;
- linearity >= 0.90.

**Display wording:** “Composed mostly in place, with little later revision.”

**Never call this “human” or “authentic.”** Smooth linear composition is compatible with ordinary fluency **and** retyping/transcription.

### 3. **Lightly revised**

**Definition:**

- direct paste share < 60%; and
- `0.10 <= revision_load < 0.35` **or** `0.05 <= post_context_revision_share < 0.20`.

**Display wording:** “Some rewriting/rearrangement after initial composition.”

### 4. **Heavily revised**

**Definition:**

- direct paste share < 60%; and
- revision load >= 0.35 **or** post-context revision share >= 0.20 **or** at least one replacement event changed >= 40% of the passage.

**Display wording:** “Substantial rewriting after initial composition.”

### 5. **History unclear**

This category should exist from day one.

Use it when:

- the document begins with substantial existing content;
- history is incomplete/merged;
- import/conversion likely occurred;
- parser encounters unknown operations;
- collaborator/suggestion semantics make lineage ambiguous.

This is essential for fairness.

---

## 4.6 Secondary overlays worth adding later

These should be *badges/patterns*, not mutually exclusive heatmap colors.

### “Pasted then heavily edited”

Direct paste share >= 40% **and** revision load after the paste >= 0.30.

Pedagogically valuable because it distinguishes unmodified transfer from synthesis/editing.

### “Deleted and rewritten”

At least 50% of a prior passage was deleted and replaced within the same region, with replacement >= 40 characters.

### “Written out of order”

Initial creation time of the passage is substantially later than passages that follow it in final order. A simple display metric is percentile rank difference between final position and creation sequence.

### “Large insertion, source unknown”

Use for rapid/atomic insertion when there is no direct paste marker. This category is critical for voice typing, extensions, Smart Compose-like behaviors, and unknown Google features.

### “Possible transcription/retyping” — **research preview only**

Do not make this an MVP heatmap category.

---

# 5. Can retyping be distinguished from fluent original writing?

This is the most important scientific caveat in the entire product.

## What the evidence says

There is now meaningful evidence that **true keystroke dynamics** can distinguish copy-typing/non-original reproduction from composition under some conditions.

- A 2026 *Journal of Educational Measurement* study reports >94% accuracy under ideal known-session conditions and >89% in operational settings using proxies for non-original status ([Deane et al.](https://onlinelibrary.wiley.com/doi/10.1111/jedm.12431)).
- A 2026 *Assessing Writing* study of 122 adults found strong behavioral differences between copy-typing and natural composition; deep-learning models were around 0.90 accuracy, with deletion rates, sentence-boundary behavior and word-initiation patterns among important features ([study](https://www.sciencedirect.com/science/article/pii/S1075293526000589)).
- A 2024 academic-integrity experiment using keystroke dynamics to distinguish AI-assisted and non-assisted writing reported accuracy ranging roughly from 75–86% in condition-specific settings and much weaker/generalized performance in some condition-agnostic settings ([Kundu et al.](https://arxiv.org/abs/2406.15335)).

## Why this does **not** justify an MVP detector

1. Those studies generally use direct keystroke telemetry, not reconstructed Google Docs revision bundles.
2. Composition-versus-transcription models can confound keyboard skill, language proficiency, task type, device and disability/access technology.
3. 90% accuracy is not remotely sufficient if the output is treated as a disciplinary verdict across hundreds of students.
4. A motivated student can adapt behavior, and synthetic keystroke generation is an active research problem ([synthetic keystroke dataset](https://pmc.ncbi.nlm.nih.gov/articles/PMC10139888/)).

### Recommendation

For v1, show descriptive features associated with transcription—long unusually regular bursts, very low revision, sentence-boundary timing patterns—only inside an **experimental diagnostics panel**, with wording such as:

> “This passage was entered in a highly linear pattern. That pattern can occur in fluent composition, transcription/retyping, dictation, or prepared text. It is not an authorship determination.”

If you eventually add a transcription model, validate it on **high-school writers**, including multilingual writers and accommodation users, before teacher-facing release.

---

# 6. False positives, equity, and fairness

## 6.1 Groups at particular risk

### English learners / multilingual writers

L2 writers often pause differently from L1 writers, and pause interpretation is highly context-dependent ([Barkaoui](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/abs/what-can-l2-writers-pausing-behavior-tell-us-about-their-l2-writing-processes/BA790529729B7CD2151217EB97B78D1E), [Révész et al.](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/exploring-second-language-writers-pausing-and-revision-behaviors/A84135AD35874EDEDF50D8BD6D36B911)). Do not define “normal human writing” using one pause or fluency profile.

Traditional AI detectors create an additional warning: a Stanford-led study found that several detectors misclassified a majority of evaluated TOEFL essays by non-native English writers as AI-generated; Stanford summarized a 61.22% false-positive figure in that tested setting ([Stanford HAI](https://hai.stanford.edu/news/ai-detectors-biased-against-non-native-english-writers), [paper summary](https://scale.stanford.edu/publications/gpt-detectors-are-biased-against-non-native-english-writers)).

### Speech-to-text / IEP / 504 accommodations

Dictation can appear as rapid multi-character insertion with a very different pause/revision profile from keyboard composition. The extension should provide a per-document **“input method/accommodation context”** note that a teacher can set manually, but it should not store disability details in a backend.

### Students drafting on paper or elsewhere

A legitimate paste of a complete draft will look exactly like a complete draft pasted in. The report must state this alternative explanation whenever a large transfer is highlighted.

### Strong fluent writers

Low revision and long bursts are compatible with skill, preparation, or extensive mental/off-document planning.

### Slow typists / device differences

Raw WPM should never be used as a red/green threshold. Chromebooks, external keyboards, touch screens, motor differences and keyboarding training all matter.

---

## 6.2 False positives: AI detectors versus process evidence

Text-only AI detection has documented false-positive and subgroup-bias problems. Process evidence avoids the specific error of calling prose “AI-like” based on linguistic style, but it introduces a different class of uncertainty: **the same observable process can have multiple causes.**

Examples:

- large paste → AI, research notes, teacher-provided material, paper draft, another app;
- smooth typing → fluent composition, memorized text, retyping, dictation;
- heavy revision → authentic thinking, Grammarly rewrite, peer editing;
- low writing time → cheating, strong preparation, short task, drafted elsewhere.

There is not yet a large independent evidence base giving real-world false-positive rates for retrospective school writing-process products such as Draftback, Revision History, or Process Feedback. Vendor adoption statistics and testimonials are not substitutes for validation.

### Required wording rule

Every output should be framed as **process description**:

- Good: “63% of this paragraph entered through two recorded paste events.”
- Good: “This passage had little later revision.”
- Good: “The history does not identify the source of this 240-character insertion.”
- Bad: “Likely AI.”
- Bad: “Student did not write this.”
- Bad: “Authenticity score: 27/100.”

---

# 7. Presentation and UX

## 7.1 Recommended layout

### In-document layer

The Google Doc remains visible. When the extension is activated, final text receives a **subtle background tint/underline pattern** by process category. Hovering a passage shows a compact tooltip:

- category;
- first-written time;
- direct paste share;
- revision load;
- author;
- “Replay this passage” button.

### Right side panel

Top to bottom:

1. **Summary card** — word count, active time estimate, sessions, direct-paste share, heavily revised share, unknown-history share.
2. **Legend** — categorical colors plus texture/icon, never color alone.
3. **Timeline strip** — active sessions with paste/revision markers.
4. **Selected passage inspector** — exact events and metrics for the clicked passage.
5. **Replay control** — starts 10–20 seconds/events before the passage's first relevant event, not from document creation.
6. **Context note** — teacher can record “student reports drafting on paper,” “voice typing permitted,” etc. Keep this local or in the exported report only.

### Class dashboard

Separate page with sortable descriptive metrics and small stacked bars showing how each final document is distributed across process categories. No risk score.

---

## 7.2 Color and accessibility

Do not use green = good / red = bad. That turns descriptive process categories into moral judgments and is poor color-accessibility design.

Use a color-blind-safe categorical palette with redundant patterns/icons, for example:

- transferred/pasted → amber + clipboard icon;
- composed linearly → blue + straight-line icon;
- lightly revised → teal + pencil icon;
- heavily revised → purple + rewrite icon;
- unclear history → gray hatch + question icon.

Opacity should be low enough that text remains comfortably readable; selected passages can increase contrast.

---

## 7.3 Good analogies from other tools

### Git blame / code review

Git “blame” works because it maps provenance onto the **current lines** of a file rather than forcing developers to replay every commit. Your heatmap is conceptually “blame for writing process,” but should describe process class rather than imply blame.

### Diff views

Code review succeeds by showing the changed region plus enough surrounding context. Passage replay should similarly start near the selected event, with the relevant passage highlighted while the rest of the document stays stable.

### Writing analytics

Writing research tools visualize bursts, pauses and revisions, but studies caution that logs do not directly reveal cognition. The UI should therefore let visual patterns prompt questions rather than translate them into hidden psychological interpretations ([Révész et al.](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/exploring-second-language-writers-pausing-and-revision-behaviors/A84135AD35874EDEDF50D8BD6D36B911)).

---

## 7.4 Should students see the same view?

**Yes, with the same underlying evidence.**

Students should be able to inspect what a teacher could inspect. This improves procedural fairness and turns the tool into a writing-reflection aid rather than hidden surveillance. Process Feedback explicitly supports student-facing process reflection and recommends telling students early that process data matter ([teacher guides](https://processfeedback.org/docs/teachers/)). Grammarly Authorship similarly emphasizes two-sided transparency ([Grammarly Authorship](https://www.grammarly.com/edu/authorship)).

What the evidence does **not** establish well is the size of any deterrence effect. Vendor case studies report reductions in academic-integrity cases, but these are implementation-specific and not strong causal evidence. Transparency is justified more strongly by fairness and pedagogy than by a proven deterrence percentage.

---

# 8. Privacy and legal

> This section is product-research guidance, not legal advice. District/state counsel should review the final data flow before deployment.

## 8.1 FERPA

FERPA generally restricts disclosure of personally identifiable information from education records without consent, subject to exceptions. The U.S. Department of Education explains that vendors/contractors can sometimes function as school officials when performing institutional services under the school's direct control and subject to use/redisclosure limits ([Student Privacy Policy Office](https://studentprivacy.ed.gov/faq/who-school-official-under-ferpa)).

### Local-only implication

If your extension's code executes on the teacher's device and **the developer never receives document text, student identity, revision history, document IDs, or derived per-student analytics**, there may be no FERPA disclosure *to you* in the ordinary sense. That is a materially better posture than a cloud service ingesting student work.

But it does **not** mean “FERPA does not apply.” The teacher and school still possess education records, and exporting, sharing, caching, or uploading reports can create new records/disclosures.

---

## 8.2 COPPA

COPPA applies to covered operators collecting personal information online from children under 13. FTC guidance says schools can sometimes consent on parents' behalf when an edtech service collects information solely for school-authorized educational purposes, and recommends that schools/districts—not individual teachers—make these decisions where possible ([FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions), [FTC edtech guidance](https://www.ftc.gov/business-guidance/blog/2020/04/coppa-guidance-ed-tech-companies-schools-during-coronavirus)).

A truly local extension that does not transmit student data to the developer greatly reduces COPPA exposure because the operator is not collecting that data. However, telemetry, crash reporting, support screenshots, shared reports, or remote analytics can silently destroy the “no collection” premise.

---

## 8.3 State student-privacy laws and DPAs

Many states and districts impose requirements beyond FERPA/COPPA, and districts often require vendor review or a DPA even when a vendor claims not to store student data. The correct conclusion is therefore:

> **Local-only processing can substantially simplify a DPA and may mean the vendor receives no student record at all, but it does not categorically eliminate district approval or DPA obligations.**

Process Feedback's own institutional posture illustrates this reality: it offers local-only extension deployment with sharing disabled, yet still offers schools a formal DPA/institutional agreement because procurement requirements extend beyond raw cloud storage ([institutional pilot guide](https://processfeedback.org/docs/pilot-onboarding-gdocs/), [institutional pricing](https://processfeedback.org/institutional-pricing/)).

---

## 8.4 Local-first pitfalls

To preserve the privacy advantage:

- do not send document text to analytics/crash tools;
- do not put names/document IDs into error logs;
- avoid persistent IndexedDB/localStorage retention by default;
- provide a one-click “clear local analysis data” control;
- set a short automatic cache TTL;
- warn that exported PDF/HTML reports contain education-record information;
- never put report content in URLs or query strings;
- do not create cloud share links in the MVP;
- do not use third-party AI APIs to “interpret” student writing-process data;
- ensure extension updates cannot silently change the data flow without a new disclosure.

---

## 8.5 What students should be told

Tell students **before** the assignment, not after suspicion arises:

- that Google Docs already records detailed edit history;
- that the teacher may use a tool to summarize that history;
- what information will be visible: paste/transfer events, timing, revision patterns, authorship contributions;
- that the tool provides process evidence, not an AI verdict;
- what workflow is expected (e.g., draft in the assigned Doc if process evidence is part of the assignment);
- how accommodations or legitimate external drafting should be handled;
- whether reports are saved or exported and for how long.

This reduces the “surprise surveillance” problem Draftback itself warns about: people granted edit access do not always realize that fine-grained process history is accessible ([Draftback](https://draftback.com/)).

---

# 9. Open-source considerations

## 9.1 MIT versus AGPL

### MIT

Choose MIT if the goal is maximal adoption by teachers, districts and other developers, including incorporation into proprietary products. It is simple and compatible with the Harvard `gdocrevisions` reference implementation's licensing approach ([gdocrevisions](https://github.com/harvard-vpal/gdocrevisions)).

**Risk:** a commercial vendor can take the project, improve it privately, and not contribute changes back.

### AGPLv3

Choose AGPL if your priority is keeping networked/modified derivatives open and ensuring commercial hosted variants publish source modifications.

**Risk:** school vendors and commercial edtech integrators may avoid AGPL dependencies, and mixing AGPL code into a browser extension constrains downstream licensing.

### Recommendation

For a teacher-led public-good extension whose value depends on broad district trust and inspectability, I would choose **AGPLv3 if preserving openness is a core mission**, otherwise **MIT if adoption/ecosystem reuse is the overriding goal**. A pragmatic middle path is MPL-2.0, but if the actual choice is MIT vs AGPL, the deciding question is whether proprietary forks are acceptable.

---

## 9.2 Publishing detection logic

Students being able to inspect the logic is **not** a decisive reason to close the source.

If the product's claims depend on secret thresholds, the claims are brittle. Students already know the basic evasion strategy: avoid giant pastes and simulate gradual typing. Teacher forums explicitly discuss automated tools that type generated text into Docs ([teacher thread](https://www.reddit.com/r/Teachers/comments/1hp8pru/)).

Open source has offsetting benefits:

- districts can inspect data flows;
- researchers can audit fairness assumptions;
- bugs in the Google parser can be fixed collaboratively;
- students can understand the evidence used in decisions about them.

**Recommendation:** Make the descriptive event logic fully public. If you later develop a learned transcription classifier, publish the feature definitions and validation results even if model weights are treated separately. Security through obscurity should not be the integrity model.

---

# 10. Ranked feature list

## MVP — build these first

### 1. Passage-level final-text process heatmap

The core wedge. Five categories: transferred/pasted, composed linearly, lightly revised, heavily revised, history unclear.

### 2. Click passage → focused replay

Start immediately before the relevant passage's creation/change. Never force full-document replay.

### 3. Exact evidence inspector

For the selected passage: event timestamps, inserted/deleted character counts, source confidence, actor, revision load, and a plain-English explanation.

### 4. Document summary card

Active writing time estimate, sessions, active days, direct-paste share, revision share, largest paste, unknown-history share.

### 5. Local-only processing + no account

No document content or history to your servers.

### 6. Fairness/uncertainty labels

“Source unknown,” “history may be incomplete,” and alternative explanations shown wherever relevant.

### 7. Exportable evidence report

A local PDF/print view containing selected passage evidence, summary, and methodological caveats. **Do not** include a risk score.

### 8. Student-view mode

Same evidence, phrased for reflection and self-checking.

### 9. Import/history diagnostics

Warn when the document appears to start with preexisting content or when the parser cannot reconstruct complete lineage.

### 10. Automated regression test corpus

Fixtures for paste types, cut/move, suggestion mode, multi-author docs, voice typing, Smart Compose, Gemini, Grammarly, imported DOCX, Google Docs tabs, and multi-account login. This is an engineering feature, but it is existential for an undocumented API dependency.

---

## Later — after the core is stable

1. **Class dashboard / triage** with sortable descriptive metrics.
2. **Google Classroom workflow helper** for opening assigned Docs in batch, without ingesting student content remotely.
3. **“Pasted then heavily edited” and “deleted/re-written” overlays.**
4. **Composition-order visualization.**
5. **Quote/citation handling** so properly cited transferred text can be annotated by the teacher and de-emphasized.
6. **Teacher-added context notes** for paper drafts, accommodations, approved AI use, peer review.
7. **Cross-document drafting links** only if Google exposes a defensible way to do this without broad Drive access.
8. **Research-mode transcription indicators**, disabled by default.
9. **Optional institution-managed policy presets** defining allowed input/AI practices per assignment.
10. **Firefox/Edge ports** after the Chrome/Google Docs parser is reliable.

---

## Do not build initially

- generic AI-text detector;
- “authenticity percentage”;
- cheating risk score;
- biometric student identity verification;
- hidden student monitoring;
- cloud report storage;
- broad Drive crawl;
- parent-facing automated accusations.

---

# 11. Precise metric and category specification

| Metric | Definition | Default threshold/handling | Interpretation |
|---|---|---|---|
| Direct paste share | Final chars whose lineage has direct paste metadata / final chars | Report exact % | Descriptive transfer evidence |
| Inferred large insertion share | Final chars from atomic insertions >=80 chars with no paste marker | Keep separate from paste | Source unknown |
| Revision load | (deleted chars from lineage + later inserted chars into established passage) / final chars | Light 0.10–0.35; heavy >=0.35 | Amount of reworking |
| Post-context revision share | Final chars changed after author advanced >=100 chars beyond region / final chars | Light 0.05–0.20; heavy >=0.20 | Later return/restructuring |
| Linearity | Initial chars entered near current frontier / initial chars | Linear >=0.90 | Composition order, not authenticity |
| Session | Activity separated by >=30 min idle | Configurable | Work segmentation |
| Active time | Time within activity windows, ignoring gaps >2 min | Clearly labeled estimate | Engagement context |
| Large direct paste | Direct paste span >=80 chars | Event marker | Investigation shortcut |
| Large unknown insertion | Atomic insertion >=80 chars, no paste metadata | Separate label | Possible dictation/tool/import/etc. |
| Heavy replacement | Single rewrite changes >=40% of sentence/span | Heavy revision | Significant rewriting |
| History completeness | Parser/import/revision coverage status | good / partial / unclear | Confidence in all other metrics |

### Heatmap precedence

1. If history completeness is unclear for the majority of a passage → **History unclear**.
2. Else if direct paste share >= 0.60 → **Transferred/pasted**.
3. Else if heavy-revision condition met → **Heavily revised**.
4. Else if light-revision condition met → **Lightly revised**.
5. Else if linearity >= 0.90 and direct paste share < 0.10 → **Composed linearly**.
6. Else → **Mixed process** (neutral fallback; use a split/striped rendering rather than forcing a false category).

I would add **Mixed process** to the implementation even though the original concept named four process types. Real documents will not always fit four bins cleanly.

---

# 12. Top five design rules

1. **Describe observable events, not inferred intent.** “Pasted” is valid when you have a paste event; “AI-generated” generally is not.
2. **Never encode virtue as color.** No green = authentic / red = cheating. Use neutral categorical colors and icons.
3. **Make uncertainty visible.** Imported text, incomplete history, unknown-source insertion, dictation and extension edits need first-class states.
4. **Scan first, replay second.** The whole product advantage is reducing teacher review time. Every visualization must answer “where should I look?” before “watch the movie.”
5. **Use process data pedagogically as well as investigatively.** A student should be able to use the same heatmap to discuss drafting and revision; that keeps the design from drifting into opaque surveillance.

---

# 13. Risk register

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Google changes `revisions/load` or command schema | Technical | High over product lifetime | Critical | Adapter layer, automated fixture suite, feature flag, fast parser updates, graceful “history unavailable” mode |
| Chrome Web Store objects to undocumented authenticated endpoint behavior | Policy/technical | Medium | High | Minimal host permissions, explicit user action, no credential interception, transparent listing/privacy policy, prepare fallback distribution/testing plan |
| Revision history batches operations differently than assumed | Technical | High | High | Validate against live event fixtures; confidence levels; never call reconstruction “keystroke exact” |
| Voice typing/Smart Compose/Grammarly/Gemini misclassified as paste or linear typing | Equity/technical | High | High | Unknown-source category; dedicated fixtures; no semantic source claims without direct evidence |
| Student drafted legitimately elsewhere | Fairness | High | High | Mandatory alternative-explanation text; teacher context notes; no verdict/risk score |
| ELL writing patterns misread as suspicious | Equity | Medium-high | High | Do not score pause/typing fluency as authenticity; validate with multilingual students |
| IEP/504 assistive technology produces unusual history | Equity/legal | Medium | High | Input-method context; no default suspicion; accessibility testing; local storage only |
| Student uses auto-typing to simulate process | Integrity | Medium and rising | Medium-high | Explain limits; focus on process evidence, oral follow-up and assignment design; do not market as cheat-proof |
| Teacher overrelies on heatmap | Product/equity | High | Critical | No overall score; uncertainty warnings; required evidence drilldown; conversation prompts |
| Local cache exposes student history on shared teacher device | Privacy | Medium | High | ephemeral cache, TTL, clear-data control, encryption where practical, avoid persistent content |
| Exported report is emailed/shared insecurely | Privacy/legal | Medium | High | warning on export; default redaction options; no auto-upload/share |
| “No server” is marketed as “no DPA needed” and conflicts with district/state policy | Legal/procurement | Medium | High | Say local-first reduces data disclosure but approval requirements vary; publish exact data-flow diagram |
| Open source makes thresholds easy to game | Integrity | High | Medium | Assume adversarial transparency; evidence not verdict; evolve features based on validated process research |
| Biometric/transcription classifier creates disability/language bias | Equity/legal | Medium if built | Critical | Keep out of MVP; require prospective validation and subgroup reporting |
| Multi-author/group Docs confuse student attribution | Technical/fairness | Medium | High | per-actor lineage; collaborator mode; disable individual authorship interpretations in group docs |
| History deleted/merged by owner or Google | Technical/evidence | Low-medium | High | completeness indicator; never imply absence of events proves absence of edits |

---

# 14. Open questions that should be answered before building

## Technical blockers

1. **What exactly does the current 2026 `revisions/load` payload expose for paste/cut/move/source metadata?** Reproduce it yourself; do not rely on competitors' marketing.
2. **Can external versus internal paste be distinguished reliably across Chrome, Workspace editions, and Docs tabs?** Revision History claims yes; validate independently.
3. **How are voice typing, Smart Compose, Gemini, Grammarly, suggestion mode, and DOCX import encoded today?** Build a fixture document for each.
4. **What happens when version history is merged/deleted, or a document has extremely long history?** Establish a reliable “coverage/completeness” test.
5. **Can a Manifest V3 extension perform the required authenticated same-origin fetch reliably without prohibited credential/token handling?** Test this in a minimal Web Store-compliant prototype before designing the rest of the product.

## Product-validation questions

6. **Does the heatmap reduce teacher review time versus Revision History and Process Feedback?** Target measure: median seconds to identify and inspect a planted process event across 25–30 papers.
7. **Which unit works best: sentence, clause, or adaptive span?** Run a teacher usability test before locking the visual model.
8. **Do teachers understand “composed linearly” as neutral, or do they treat it as suspicious?** Wording may matter more than threshold tuning.
9. **What minimum evidence do teachers/administrators consider fair before contacting a student?** This should shape report defaults.
10. **Should the student view be identical or simplified?** Underlying evidence should be identical, but explanatory text may differ.

## Research questions

11. **Can transcription/retyping be detected from retrospective Google Docs mutations with useful accuracy, not raw keystrokes?** This requires your own study.
12. **How do thresholds differ for high-school L1, multilingual, dyslexic, motor-impaired, speech-to-text, and advanced writers?** Do not extrapolate adult lab results.
13. **Which process measures predict teacher concern without producing unacceptable subgroup disparities?** The correct outcome may be that no predictive score should exist.

## Legal/procurement questions

14. **Will target districts approve a local-only extension without a DPA, or still require one as a vendor-management rule?** Ask 5–10 district privacy officers before release.
15. **Does your planned crash/telemetry stack preserve the claim that student data never leave the browser?** Many “local-only” products accidentally fail here.

---

# 15. Recommended build sequence

### Phase 0 — feasibility spike

Create a throwaway Chrome extension that reads one teacher-owned test Doc, normalizes fine-grained revisions, and reconstructs final-character lineage. Build fixture Docs for ordinary typing, external paste, internal paste, cut/move, voice typing, Smart Compose, Gemini, Grammarly, suggestion mode, collaborator edits, imported DOCX, restored versions, and tabs.

**Go/no-go criterion:** You can reconstruct final-text spans with high confidence and identify direct paste versus unknown insertion without requiring broad Drive OAuth.

### Phase 1 — single-document MVP

Ship local-only analysis, summary, five-category heatmap + Mixed, passage inspector, focused replay, and printable report. No AI detector, no class dashboard, no transcription score.

### Phase 2 — classroom workflow

Add batch opening/dashboard, review status, Google Classroom conveniences, and teacher notes. Keep the dashboard descriptive.

### Phase 3 — research features

Only after collecting opt-in research data under appropriate school/research governance, test whether retrospective mutation patterns can distinguish transcription/retyping in actual high-school conditions. Publish subgroup performance before productizing anything.

---

# Final recommendation

**Build the heatmap. Do not build an “AI detector with a prettier UI.”**

Your strongest opportunity is that teachers currently have rich evidence but poor navigation. Existing retrospective products generally answer, “Play back how this document was made.” Your product can answer the more useful first question:

> **“Show me, on the finished paper, which parts were transferred, composed linearly, revised lightly, revised heavily, or cannot be confidently reconstructed—and let me inspect the evidence for any one of them.”**

That is both faster and more defensible.

The technical architecture should assume that Google's fine-grained history interface is an **unsupported dependency that will break occasionally**. The product architecture should assume that **no writing pattern is equivalent to intent**. The fairness architecture should assume that the same behavior may arise from language learning, disability accommodation, external drafting, dictation, fluent writing, or misconduct. If those assumptions are built into the product from the beginning, the extension can be genuinely useful without becoming another unreliable accusation engine.

