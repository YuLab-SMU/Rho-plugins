# Skills

`@rho-workspace/plugin-skills` 0.1.0 keeps how work is done in a project: the methods the
person chose, the conventions they keep and the traps the work ran into, as skills every Agent
in the project reads.

A project skill is an ordinary `SKILL.md` in the project's `.claude/skills/<name>/` folder,
with a name, a one-line description of when it applies, and its text. Claude Code loads
skills from that folder by itself; other Agents read them with `skills.list` and
`skills.read`. A skill's version is the digest of its file.

`SkillsHost` writes a skill through `skills.change`: a new one, a new text for one, or its
removal. Each change is made on the version the writer read (`expectedVersion`; a stale one
is refused) and keeps who made it, a one-sentence reason, its evidence (a Notebook cell, a
conversation, a file, an annotation, a place or a note) and the versions before and after.
The same `changeId` from the same caller returns the same change and never writes twice.
`skills.undo` puts a skill back as it was before its newest change, while the file is still as
that change left it; the undo is a change of its own and can be undone.

A file changed by anything else (an editor, Git, an Agent's own file tools) reads as changed
outside Rho, with what changed since the newest recorded version. Before anything is written
over it, it is kept as it was found, as a change by `outside`; such a change is undone where it
was made, not here. A skill written by hand is listed like any other, with a problem when its
frontmatter does not name it or has no description, since Agents could not load it then.

Limits (`skillsLimits`, each configurable): the protected resource is the Agent's context and
the project's state folder. A project holds at most 24 skills and each `SKILL.md` at most
32 KiB; a change past either is refused with the named limit and the skill stays as it was. At
most 1000 changes are kept, the oldest going first and counted. A read returns 20 changes (50
at most) and a difference of at most 400 lines, the rest counted as cut.

Links are refused: skills are read and written only inside the project. A skill guides; it
grants nothing. Versions and the change list live under `.rho/plugins/skills/` in the project.

```sh
npm run build
npm pack --workspace plugins/skills --ignore-scripts
```
