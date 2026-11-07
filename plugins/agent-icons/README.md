# Agent icons

Marks and names of the Agents and model makers that Rho shows: in the Agents tab,
conversation rows, the message box and the model menus. An Agent is known by the name
it gave: its ACP `agentInfo`, its MCP client's `clientInfo`, or the session name it
chose when it connected. The catalog says which words in such a name identify an
Agent or a maker.

```ts
import { agentIcon, agentName } from '@rho-workspace/plugin-agent-icons';

agentIcon('hermes-agent-yonghe')?.id;  // 'hermes'
agentName('dsh-deepseek-agent');       // 'DeepSeek Harness'
agentIcon('My-research-agent');        // null: the application shows its initial
```

`agentIcon(name)` returns the first entry, in catalog order, that has an alias
among the name's words. Words are runs of letters and digits, compared in lower case,
and an alias matches whole consecutive words: `dsh` matches `dsh-deepseek-agent` but
not `dshell`. `agentName(name)` gives an Agent product's own name (`agent: true`) and
leaves any other name as it was given, so a model called `DeepSeek V4.1` keeps its
name. `agentIconById(id)` and `icons` give the entries themselves.

Each entry's `src` is a `data:` URL, SVG or PNG. Draw it as an image, never as page
markup. Entries with `ink: true` are one-colour marks: draw them as a mask in the
theme's ink, so that they follow the theme. Draw the others as they are.

## Adding or changing an Agent

1. Put the icon in `icons/`: an SVG with its own namespace and a 24 × 24 viewBox, or
   a PNG, at most 32 KiB. It must have no scripts, event handlers or references
   outside itself.
2. Add an entry to `agents.json`:
   - `id`: a stable id.
   - `name` and `maker`.
   - `agent`: true for an Agent product, false for a model maker or platform.
   - `ink`: true for a one-colour mark.
   - `aliases`: lowercase words, joined by hyphens.
   - `icon`: the file in `icons/`.
   - `source`: `lobehub` or `official`.
3. Place the entry before any entry whose aliases would also match its names. An
   Agent goes before its maker: `deepseek-harness` comes before `deepseek`, and
   `github-copilot` before `copilot`.
4. Run `npm run build`, then `node --test test/agent-icons.test.mjs` from the
   repository root.

The build refuses:

- a missing, oversized or active icon;
- an icon file that no entry uses;
- an alias used by two entries;
- an id used twice.

## Sources

Most marks come from [`@lobehub/icons-static-svg`](https://github.com/lobehub/lobe-icons)
1.102.0 (MIT), through the ai-agent-icons collection of 2026-11-03, which compared
each mark with its product's site. The collection found the lobehub marks for GLM and
Tiangong outdated and used the products' own icons instead (`official`). Claude Code,
Codex, OpenCode and Nous Research (for Hermes Agent) were added directly from the same
lobehub version. Every mark belongs to its owner and is used only to identify it; see
[LICENSE](LICENSE).
