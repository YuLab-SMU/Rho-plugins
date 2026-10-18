# Plugin catalog presentation

Each compiled plugin descriptor owns optional human-facing presentation. Rho
consumes these fields; it does not infer copy from package names, operation names
or Skill instructions. The nine 0.4.0 packages carry the Paper U1 catalog copy,
icons, descriptions, ordering, action/view descriptions, Skill names/descriptions,
developer, license, public links and dependency purposes. These are additive
fields at the existing entry version, not new functional UI renderers.

`EntryPresentation` supplies `displayName`, `description`, `order`, `readOnly`
and `runsCode`. A grouped action is read-only only when all its members declare
it. `PluginPresentation` adds category/order, tagline, prompts, view note, icon,
developer/license/links, `dependencies` with a `pluginId` and human purpose, and
`uses`. Icons contain fixed SVG path/dot geometry or text and colors; they contain
no HTML, scripts or remote assets. Skill presentation sits on the real Skill
declaration and leaves its content digest unchanged.

Presentation is descriptive. Dependency purposes can describe action-specific or
optional cooperation; functional `requires`, native preconditions and grants
remain authoritative. A catalog introduction does not make a Skill callable or
grant access to an operation. Missing metadata remains absent.

## External executable observation

R and Requirements export `observeNativeAvailability(rscript)`. This observes
whether the explicitly selected executable file exists and is executable, or
searches PATH for a bare name. It starts no process, Host or native session. R
names the affected script operation and explains that exported object reads still
work. Requirements names package checks and preparation separately. The result
has `state` (`present`, `missing`, `unknown`), `tool`, `methods`, `checkedAt`,
`scope: executable-file`, and owner-authored failure copy.

This observation does not establish R's version, compatibility, packages, project
readiness or execution outcome. The operation checks its actual conditions when
invoked. Reads do not install anything or replace a retained request identity.

The shared file primitive `observeExecutable` bounds PATH search directories by
`maxSearchDirectories` (default 128). Exceeding that bound preserves uncertainty
as `unknown` and names the limit rather than reporting the executable missing.
An unreadable observation also stays unknown. It exposes no selected private path.

## Verification

Owner checks cover all nine descriptors, Skill metadata/digests, inert presentation
modules and real executable-file observations, including a non-executable file,
a missing file and an exceeded PATH-search bound. The executable fixture would
write a marker if invoked; the marker remains absent. Isolated owner installation
checks cover package boundaries; Rho separately checks the assembled browser and
physically reduced installations. See [Status](STATUS.md) for executed evidence.
