import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Copy acceptance is Paper U1-06d, not package descriptions or Skill prose.
const copy = {
  documents: ['Documents', 'Code & data', 'Open, edit and save code and notes, with undo', [
    '“Open clean.R and add a comment above each step.”',
    '“Undo your last edit to notes.md.”',
    '“Save notes.md, unless someone changed it on disk.”',
  ]],
  files: ['Files', 'Project files', "Keep each file's versions and check run outputs", [
    "“List the files in data/ and which version of each you're using.”",
    '“Check that the last run produced every output it declared.”',
    "“Add figures/umap.png to this project's outputs.”",
  ]],
  r: ['R', 'Code & data', 'Run R scripts and read the objects they export', [
    '“Run analysis.R and tell me which objects it exported.”',
    '“Rerun fit.R with alpha = 0.1 and compare the estimate with the last run.”',
    '“Run my unsaved edits to clean.R without saving the file first.”',
  ]],
  requirements: ['Requirements', 'Code & data', 'Check the R packages a script needs', [
    '“Check whether this project has the packages fit.R declares.”',
    "“Install the missing ones into this project's library.”",
    '“Which version of ggplot2 does this project use?”',
  ]],
  tables: ['Tables', 'Code & data', 'Browse and compare CSV or JSON tables', [
    '“Show rows of results.csv where p < 0.05, largest effect first.”',
    "“Join samples.csv and scores.csv on sample_id and list what didn't match.”",
    '“How many rows in results.csv have no score?”',
  ]],
  charts: ['Charts', 'Figures & media', 'Plot columns; each point traces to its row', [
    '“Plot score against age from results.csv.”',
    '“Which points have score above 2? List their rows.”',
    "“Plot the same columns from yesterday's version of results.csv.”",
  ]],
  media: ['Media', 'Figures & media', 'Images and PDFs, with regions you can point to', [
    '“How many pages does report.pdf have, and what size are they?”',
    '“Check that the box I drew is inside page 3 of report.pdf.”',
    '“Describe figures/umap.png: format and dimensions.”',
  ]],
  annotations: ['Annotations', 'Working with your Agent', 'Comments the Agent can read and answer', [
    '“Read my comments on clean.R and reply to each one.”',
    '“List the comments in this project that have no reply yet.”',
    '“Leave a note on line 42 of fit.R explaining the change.”',
  ]],
  agent: ['Agent', 'Working with your Agent', 'Connect Claude Code and hand it exact context', [
    '“Use the rows I shared from results.csv as context.”',
    '“Which views have you opened in this project?”',
    "“Show what you've done in this project since this morning.”",
  ]],
};
const names = {
  'document.open': 'Open', 'document.read': 'Read', 'document.edit': 'Edit', 'document.undo': 'Undo', 'document.undoOwn': 'Undo my edits', 'document.revert': 'Revert one change', 'document.history': 'Read change history', 'document.change.read': 'Read a change', 'document.save': 'Save', 'document.abandonSave': 'Give up an interrupted save',
  'resource.list': 'List', 'resource.read': 'Read', 'resource.register': 'Register', 'artifact.check': 'Check outputs',
  'object.read': 'Read an exported object', 'action.submit': 'Run a script',
  'requirements.check': 'Check', 'requirements.prepare': 'Install into the project',
  'data.page': 'Page, sort and filter', 'data.compare': 'Compare two tables', 'data.plot': 'Plot two numeric columns',
  'media.describe': 'Describe an image or PDF and check regions',
  'annotation.create': 'Create', 'annotation.list': 'List', 'annotation.read': 'Read', 'annotation.reply': 'Reply',
  'context.create': 'Share and read context', 'context.read': 'Share and read context',
  'binding.list': 'Open and close views', 'binding.open': 'Open and close views', 'binding.close': 'Open and close views', 'binding.activity': 'Activity',
};
const views = { 'rho.editor': 'Editor', 'rho.object': 'Object', 'rho.table': 'Table', 'rho.scatter': 'Scatter', 'rho.media': 'Media' };

test('all nine headless descriptors ship the Paper U1-06d copy and independent effect markers', async () => {
  const seen = [], seenViews = [];
  for (const [id, expected] of Object.entries(copy)) {
    const { plugin } = await import('@rho-workspace/plugin-' + id);
    const p = plugin.presentation;
    assert.deepEqual([p.displayName, p.category, p.tagline, p.examplePrompts], expected, id);
    assert.equal(p.examplePrompts.length, 3);
    assert.equal(p.runsCode, id === 'r' || id === 'requirements', id);
    assert.equal(p.readOnly, id === 'charts' || id === 'media', id);
    assert.ok(p.description && p.icon && p.developer && p.license, id);
    assert.ok(Number.isFinite(p.categoryOrder) && Number.isFinite(p.order), id);
    assert.ok(p.links.every(link => new URL(link.url).protocol === 'https:'), id);
    assert.ok(plugin.skills.every(skill => skill.presentation.displayName && skill.presentation.description), id);
    assert.ok([...(plugin.operations ?? []), ...(plugin.components ?? [])].every(entry => entry.presentation.description), id);
    for (const operation of plugin.operations) {
      seen.push(operation.method);
      assert.equal(operation.presentation.displayName, names[operation.method], operation.method);
      assert.equal(operation.presentation.runsCode, ['action.submit', 'requirements.prepare'].includes(operation.method));
      assert.equal(operation.presentation.readOnly, operation.effect === 'read', operation.method);
      assert.equal(operation.presentation.readOnly && operation.presentation.runsCode, false);
    }
    for (const component of plugin.components ?? []) {
      seenViews.push(component.id);
      assert.equal(component.presentation.displayName, views[component.id]);
      assert.equal(component.presentation.runsCode, false);
      assert.equal(component.presentation.readOnly, component.id !== 'rho.editor');
    }
    for (const action of plugin.actions ?? []) {
      assert.equal(action.id, 'r.execute');
      assert.deepEqual(action.presentation, plugin.operations.find(o => o.method === 'action.submit').presentation);
    }
    assert.equal(p.viewNote, id === 'annotations' ? 'Inside other views' : ['files', 'requirements', 'agent'].includes(id) ? 'No view' : undefined);
  }
  assert.deepEqual(seen.sort(), Object.keys(names).sort());
  assert.deepEqual(seenViews.sort(), Object.keys(views).sort());
});

test('presentation modules remain inert metadata with no React or DOM dependency', async () => {
  for (const id of Object.keys(copy)) {
    const source = await readFile(new URL('../plugins/' + id + '/dist/presentation.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^import\s|\brequire\s*\(|(?:^|\s)(?:window|document|sessionStorage|localStorage)\./m);
  }
});
