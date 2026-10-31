# HTML page

A browser view that shows an HTML document as the page it makes: a report knitted
from R Markdown or Quarto, a saved widget, a page an Agent wrote. It is a UI extension
over the Documents capability (`rho-ui.json`): Documents owns the text, its edits,
undo and saving; this package only shows it. It has no headless owner, operations or
Skill.

## What it shows

`HtmlView` reads the bound document from the buffer every view of that document
shares (`useDocumentBuffer` from Documents' `./ui`), so an Agent's edit or another
view's typing shows once Documents confirms it, a moment after the last change. Page
shows the page; Edit (Source where the session may only read) switches the view to the
Documents editor on the same buffer.

Before it shows a page, the view puts into it the project files the page names
(`preparePage`): stylesheets and scripts as their text, and images, media, icons and
the fonts and images a stylesheet names as data. Paths resolve against the document's
folder, or the project with a leading `/` (`./page` `projectPath`); a path that leaves
the project is not followed. A file on the web is not loaded: the page shows without
it and the view says how many it named. A file that cannot be read is named. A `<base>`
element is dropped.

The page runs in a frame the application serves for this (`pageFrame`), sandboxed with
scripts allowed and nothing else: it has an origin of its own, so it cannot reach the
application, its storage or its session, and its policy loads nothing from the network.
The frame tells the view it is ready and is sent the page once. The first script in
the page hands any link other than a place on the page back to the view: a link to a
project file opens it through `openPath`, and a link outside the project is named, not
opened. The page's own scripts can still change what the frame shows.

The view leaves project access to the application's optional shell services:
`pageFrame` for the frame, `fileBytes` for a file's current bytes, `openPath` for a
link and `languageExtensions` for Source. Without `pageFrame` the document shows as
its source; without `fileBytes` the page shows without the files it names.

## Limits

The protected resource is the browser tab. `htmlLimits.maxRenderBytes` (8 MiB) bounds
the text shown as a page; a larger document opens in Source with a note. A page takes at
most `maxFiles` (64) files from the project, each within `maxFileBytes` (8 MiB) and all
within `maxTotalBytes` (32 MiB); past them it shows without the rest and names them.

## Checks

`test/html.test.mjs` covers path resolution, the references a stylesheet names, media
types, data URLs, the link guard and the manifest. The view itself is exercised in
Rho's browser runs.
