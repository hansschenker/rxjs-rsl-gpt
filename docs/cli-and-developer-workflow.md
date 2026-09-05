# CLI and developer workflow

RSL 18 packages the public parser, validator, serializer, visualizer, and debugger as the `rsl` command. No CLI command compiles or subscribes to an Observable.

## Commands

```text
rsl validate workflow.rsl.yaml
rsl format workflow.rsl.yaml
rsl format workflow.rsl.yaml --check
rsl format workflow.rsl.yaml --write
rsl visualize workflow.rsl.yaml
rsl visualize workflow.rsl.yaml --top-down --output workflow.mmd
rsl inspect workflow.rsl.yaml
rsl debug trace.json
```

| Command     | Output                                                            |
| ----------- | ----------------------------------------------------------------- |
| `validate`  | Structural validity, graph identity, node count, and edge count.  |
| `format`    | Canonical deterministic RSL YAML.                                 |
| `visualize` | Deterministic Mermaid text after structural validation.           |
| `inspect`   | Stable JSON graph summary and topological order or diagnostics.   |
| `debug`     | Stable JSON snapshot folded from one saved execution trace array. |

`--check` exits unsuccessfully when a file is not canonical but does not change it. `--write` is the only mode that replaces an input file. `--output` writes a separate Mermaid artifact. Without these options, generated content goes to standard output.

## Exit codes

- `0` — command completed successfully;
- `1` — invalid RSL, invalid trace, failed check, or file/runtime error;
- `2` — invalid command-line usage.

Diagnostics go to standard error. Generated artifacts and successful reports go to standard output, making commands composable with ordinary shell redirection and CI steps.

## Package workflow

`npm run rsl -- <arguments>` runs the TypeScript entry during development. `npm run build` creates the distributable `dist/cli/entry.js`; the package `rsl` binary points to that file. The test lifecycle builds first and verifies the compiled executable in a child process.
