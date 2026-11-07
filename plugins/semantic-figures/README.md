# Semantic figures

An optional, independently installed Rho API-1 plugin. It has a native R capture
operation, a shared selection reader/writer, a Skill and a standalone HTML view.
Rho's base catalog, Core and scientific dependencies do not change.

The first two adapters are separate files under `adapters/`:

- `ggtree.R`: a saved `phylo`, rendered by ggtree in rectangular and circular
  layouts. Click a node to select its clade; changing layouts preserves the exact
  descendant tip set within this captured tree.
- `enrichplot.R`: a saved ORA `enrichResult`, rendered by enrichplot as a dotplot
  and cnetplot. Selecting a term highlights that term and its contributing genes;
  selecting a gene highlights the displayed terms containing it. Both views use
  one source snapshot and explicit result membership.

This is an initial functional episode, not a general semantic SVG framework.
Only explicit point layers are bound. Other native geometry remains unchanged.
Labels, network edges and arbitrary grobs do not yet have selection bindings.
There is no generated scientific explanation or automatic annotation migration.

## Install and use

```sh
rho plugin check /absolute/path/Rho-plugins/plugins/semantic-figures
rho plugin add /absolute/path/Rho-plugins/plugins/semantic-figures
```

Open the project's Plugins page and **Semantic figures → Interactive figures**.
Save your `phylo` or `enrichResult` as RDS in the project, enter that relative path
under **Capture an R object**, choose its adapter and capture it. Capture runs in
the shared local R session. Missing packages or incompatible objects are reported
in the original cell; earlier captures and selections remain available.
Capture restores the shared R session's original random seed after plotting.

R prerequisites: ggplot2, svglite, xml2, jsonlite, digest; ggtree and ape for trees,
enrichplot for enrichment. The plugin does not install packages or run enrichment.
It does not support remote R sessions in this first version.

## Objects, versions and Agent access

Each capture copies its source into `.rho-figures/<id>/source.rds`, then commits
`figure.json` with native SVG, entity bindings, package versions and the source
SHA-256. The capture never overwrites another figure. `read` checks whether the
original source changed or disappeared; the captured version remains readable.

`select` requires the figure digest and expected selection revision. Changes are
serialized with an exclusive lock and atomic replacement. A conflicting view is
refused and must refresh. Rho's extension receipt retains the original invocation
and delegated Notebook cell; a missing reply is not permission to repeat capture.
A delayed selection or context reply stays with the figure that requested it;
switching the view does not apply that reply to another figure.

The Agent discovers these six operations through `extension.describe/call`:
`list`, `capture`, `cell`, `read`, `selection`, `select`. `selection` returns exact
entities, memberships and source identity. Reading never starts R. The view's
**Show Agent context** exposes that same response; this is not a chat send or an
automatic insertion into the Agent panel's message context.

Tree clade keys derive from sorted descendant tip labels within a source snapshot.
Duplicate tip labels and unary nodes with ambiguous memberships are refused.
Term keys use the result's IDs, and gene membership comes from `geneID`. Duplicate
term descriptions or gene/term label collisions are refused because the native
network would be ambiguous. Neither a bound mark nor a successful statistical
calculation establishes a biological conclusion.

## Resource bounds and extension

The versioned defaults are `limits` in `host.mjs`: 8 MiB per source, 768 KiB per
figure response, 32 retained capture folders and 32 selected keys. R capture also
limits trees to 200 tips and networks to 150 genes. `showCategory` is configurable
per capture, from 2 to 8. An exceeded limit refuses new work; existing artifacts
are retained. Incomplete capture folders count toward retention. A deliberate
increase of the other defaults is currently a package change and installation,
not a silent per-view override. Rho's own extension quotas still apply.

New plot families belong in adapter files with their domain identity and binding
checks. They do not add branches to Rho's shell. Capture and selection transport
are shared by these two consumers; no external adapter ABI is promised yet.
Independent packaging of a family can follow a concrete dependency/lifecycle need.

## Observed episode

The application episode is [Semantic figures in Rho](https://github.com/YuLab-SMU/Rho/blob/main/docs/SEMANTIC-FIGURES-EPISODE.md).
Its inputs and provenance are prepared by
[`examples/semantic-figures/prepare.R`](../../examples/semantic-figures/prepare.R).
Run `node --test test/semantic-figures.test.mjs` here for focused state/containment
checks. Run `node scripts/semantic-figures-episode.mjs` in Rho for the native and
real-Chrome composition episode. Set `RHO_FIGURE_R_LIBRARY` to an existing extra R
library if clusterProfiler is not in the default library. No npm release is implied.
