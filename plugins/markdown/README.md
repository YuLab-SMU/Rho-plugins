# Markdown

A browser view that reads a Markdown document as formatted text. It is a UI
extension over the Documents capability (`rho-ui.json`): Documents owns the text,
its edits, undo and saving; this package only shows it. It has no headless owner,
operations or Skill.

## What it shows

`MarkdownView` reads the bound document from the buffer every view of that
document shares (`useDocumentBuffer` from Documents' `./ui`), so an Agent's edit
or another view's typing shows once Documents confirms it. A to-do ticks in place:
the view edits that line of the text through the same buffer, and the box follows the
text once the edit is confirmed. Edit (Source where the session may only read)
switches the view to the Documents editor on the same buffer. Its controls write the
Markdown for bold, italic, two heading levels, bulleted and numbered lists and to-dos
around the selection (`./format`), and take it off again; nothing else in the text is
reflowed or renumbered.

`./render` turns the text into HTML with markdown-it 14: CommonMark, tables,
strikethrough, autolinks, task lists (each naming its source line) and TeX
math through KaTeX (`$…$`, `$$…$$`, fenced `math`). The document's own HTML is
shown as text, except a line that is only an HTML comment, such as a marker an Agent
keeps under its heading, which is not shown. Relative links and images are resolved against the document's
folder, or the project with a leading `/`; a path that leaves the project is not
followed. Headings carry anchors for in-document links.

The view leaves project access to the application's optional shell services:
`openPath` for a link to a project file, `imageUrl` for an image's current bytes,
`highlight` for fenced code and `languageExtensions` for Source. Without them a
link stays inert, an image shows its description and code stays plain. Images on
the web are not loaded; they show their description.

## Limits

The protected resource is the browser tab. `markdownLimits.maxRenderBytes`
(512 KiB) bounds the text rendered; a larger document opens in Source with a note.
`maxImages` (32) bounds the images one document asks for; past it an image shows
its description. The application bounds the bytes it reads per image.

## Checks

`test/markdown.test.mjs` covers path resolution, links, images and their budget,
escaped HTML, comment-only lines, tables, task lists and their source lines, ticking
a to-do in the text, the formatting edits, math, fenced code and the manifest. The
component version names its contract (props and bindings), which saved layouts pin;
the package version moves with its code. The view
itself is exercised in Rho's `acceptance:sources`.
