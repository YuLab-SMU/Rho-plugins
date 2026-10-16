# Ordinary base-R project

This explicit acceptance consumer is an ordinary R project, outside the base npm
package. It uses only base R, stats and graphics. It fits a small linear model,
exports four observations with string IDs (including `001` and literal `NA`),
a second table with a different key namespace, PNG/PDF, saved model and exported
JSON object snapshot. The independent project script checks the saved model
coefficients and original observations without refitting it.

[project.json](project.json) supplies scripts, empty package requirements,
artifact formats/types/nulls/keys, explicit chart fields, a two-input mapping and
expected project-check facts. Rho's generic runner consumes that specification:

```sh
RHO_CORE_BINARY=/absolute/rho-core node /absolute/Rho/scripts/acceptance.mjs \
  /absolute/new-trial /absolute/Rho-plugins/examples/ordinary-r-project
```

The runner copies only listed project files into a disposable project. The same
runner accepts the [paired example](../real-r-analysis/README.md). Neither consumer
changes the base action catalog or resource reader. A pass proves headless
execution/data/context/export behavior; it does not prove a browser view.
