# Rho-plugins: current state

Updated: 2026-10-12. `main` contains selected new plugin work. The complete
former controlled implementation is preserved on the published
[`codex/legacy-plugins-before-rebuild`](https://github.com/YuLab-SMU/Rho-plugins/tree/codex/legacy-plugins-before-rebuild)
branch. The archive head and tree were verified against local Git; all removed
legacy entries match the archive's content identities and file modes.

## Implemented and verified scope

- The [Agent evaluation plugin](../plugins/agent-eval/README.md) owns the migrated
  Core CLI evaluator, trial controller, cases and grading. The shared entry also
  invokes domain-owned R artifact checks and ordinary JSON checker cases.
  It uses public binary inputs, Python's standard library and ordinary files,
  without private Core source, legacy SDK or an application prerequisite.
- The migration passed 43 regressions, eight real CLI baseline cases, six
  explicitly selected optional library cases and one real-model execute trial.
  Original model evidence regraded to the same 15/16; its remaining failure
  remains a failure. See [migration acceptance](../plugins/agent-eval/ACCEPTANCE.md).
- The [real R recipe](../examples/real-r-analysis/README.md) uses airway/GSE52778,
  donor-paired DESeq2, four donor-omission fits and 200 conditional simulations.
  Its actual native run took 9 minutes 23 seconds. Waiting interruption retained
  the original run/PID and one native entry. Original and retrieved artifacts
  each passed 12/12 checks, five saved models passed 121/121 native observations,
  and three altered counterexamples were rejected. Original failures and science
  limits remain in [fact acceptance](../examples/real-r-analysis/ACCEPTANCE.md).

## Source boundary

The former sixteen packages, Core dependency snapshots, Cargo/frontend manifests,
legacy build scripts, Jet source/patches, runtime materials and skills are removed
from main. Their complete controlled source remains in the archive and Git history.
The current plugin and recipe source is retained unchanged. Ignored local analysis
artifacts and evaluation evidence are preserved, not published or cleaned.

After removal, all 43 evaluation regressions passed. A source-only export with a
copied public Core binary passed all eight CLI baseline cases without the old
tree or a Core checkout. All 19 retained consumer files kept their original Git
content identities; 35 local document links and anchors passed.

Archive publication and main source replacement are separate steps: verify the
remote archive before deletion, commit the selected tree without rewriting
history, then publish and verify the resulting main head and tree. This source
change does not update Rho's existing lock, build a new composition or install it.

## Next selected work and limits

Priorities are R batch recipes, scientific artifact integrity/provenance/retrieval,
and reusable bounded Agent evaluation. Domain Owners keep scientific semantics;
Core keeps generic managed execution and its deterministic regressions; Rho owns
selection, assembly and presentation. See [Rebuild](REBUILD.md).

Candidate optimization, Git candidate rollback, development/validation/blind-test
management and hillclimbing remain designs. New scientific-plugin loading and
application integration are unimplemented. No evidence requires restoring all
old packages, an R-session platform, a global artifact registry or a Files rebuild.
A successful checker is not proof of autonomous research or scientific validity.
