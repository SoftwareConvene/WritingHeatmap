# Contributing

Improvements are welcome, from teachers, students and developers alike.

## Before your first merge: the CLA

Every contributor signs the [Contributor License Agreement](CLA.md) once, before their first pull request is merged. A bot comments on your pull request; you sign by commenting the sentence it gives.

The CLA lets SoftwareConvene LLC use your contribution under the AGPL **and under other licenses**. You keep your copyright and can use your own work anywhere else. Without the CLA, each outside contribution could only ever be used under the AGPL, and one contributor could block the project's future.

**If you are under 18, you and a parent or guardian both sign.** Don't sign on the pull request first, and don't mention your age there. Email **contact@softwareconvene.org** and we'll send the [guardian form](docs/cla-guardian-form.md). Once it's back, you sign on the pull request like everyone else.

## What you can and can't submit

- Only work you wrote, or work you have the right to submit. If part of it came from somewhere else, say so in the pull request and give its source and license. It has to be compatible with the AGPL-3.0. Code from projects without a license, or under a license other than the AGPL that we can't relicense, can be described in your own words but not copied.
- Code you produced with an AI tool is your responsibility, the same as code you typed.
- **No student work, ever.** Not in fixtures, screenshots, issues or commit messages. Test documents use marker words and filler text (see [docs/fixtures.md](docs/fixtures.md)). Student placeholders are "Student 1", "Student 2" and so on.

## The rules the code holds

- **Describe, never judge.** Output says what the history recorded. No AI verdicts, authenticity or risk scores, or words like "suspicious". `wording.js` is checked by a test.
- **Name the other explanations.** Every category shown to a teacher comes with the other ways the same record can arise.
- **Nothing leaves the browser.** Only `extension/content/docs.js` makes network requests, only to `docs.google.com`, only for the document the teacher opened. No analytics, no crash reporting, no remote code.
- **Student text is never HTML.** The viewer builds the page with text nodes only.
- **Unknown is a state, not an error.** When the history does not explain the text, show "History unclear" rather than a color that might be wrong.
- **Google's format stays in `lib/gdocs/`.** The rest of the code works on `lib/events.js` events.

A pull request that changes one of these needs to say so in its description, and add or change the test that holds it in `scripts/test.js`.

## Style

- No dependencies without a real argument. There are none on purpose.
- Comments explain **why**, and only where the reason isn't visible in the code.
- Match the surrounding code. There is no separate style guide.
- Run `npm test` before you push.

## Security

Don't open a public issue for a security problem. Email **contact@softwareconvene.org** and give us a reasonable window before you disclose it.
