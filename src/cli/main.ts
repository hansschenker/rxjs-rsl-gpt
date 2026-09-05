import { readFile, writeFile } from "node:fs/promises";

import type { RslExpression } from "../model/index.js";
import type { RslTraceEvent } from "../compiler/index.js";
import {
  createRslDebugSnapshot,
  renderRslMermaid,
} from "../visualization/index.js";
import { validateRslStructure } from "../validation/index.js";
import {
  parseRslExpression,
  RslYamlError,
  stringifyRslExpression,
} from "../yaml/index.js";

export interface RslCliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly read: (path: string) => Promise<string>;
  readonly write: (path: string, content: string) => Promise<void>;
}

const usage = `Usage: rsl <command> <file> [options]

Commands:
  validate <file>              Validate deterministic YAML and graph structure
  format <file> [--check]      Print canonical RSL YAML or verify formatting
  format <file> --write        Replace the file with canonical RSL YAML
  visualize <file>             Print a deterministic Mermaid flowchart
  visualize <file> -o <path>   Write the Mermaid flowchart to a file
  inspect <file>               Print a deterministic JSON graph summary
  debug <trace.json>            Fold one JSON trace array into a debug snapshot
`;

function defaultIo(): RslCliIo {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    read: (path) => readFile(path, "utf8"),
    write: (path, content) => writeFile(path, content, "utf8"),
  };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function option(args: readonly string[], short: string, long: string) {
  const index = args.findIndex((value) => value === short || value === long);
  return index === -1 ? undefined : args[index + 1];
}

function inspect(expression: RslExpression) {
  const structure = validateRslStructure(expression);
  return {
    version: expression.version,
    expressionId: expression.id,
    valid: structure.valid,
    sources: expression.nodes
      .filter((node) => node.kind === "source")
      .map((node) => node.id)
      .sort(),
    pipelines: expression.nodes
      .filter((node) => node.kind === "pipeline")
      .map((node) => ({ id: node.id, operation: node.operation.ref }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    sinks: expression.nodes
      .filter((node) => node.kind === "sink")
      .map((node) => node.id)
      .sort(),
    edgeCount: expression.edges.length,
    ...(structure.valid
      ? { topologicalOrder: structure.topologicalOrder }
      : { diagnostics: structure.diagnostics }),
  };
}

function parseTrace(source: string): readonly RslTraceEvent[] {
  const value: unknown = JSON.parse(source);
  if (!Array.isArray(value))
    throw new TypeError("Trace input must be a JSON array");
  return value as readonly RslTraceEvent[];
}

/** Execute one CLI request and return its process exit code. */
export async function runRslCli(
  args: readonly string[],
  io: RslCliIo = defaultIo(),
): Promise<number> {
  const [command, path] = args;
  if (command === undefined || command === "help" || command === "--help") {
    io.stdout(usage);
    return 0;
  }
  if (path === undefined) {
    io.stderr(`Missing file path\n${usage}`);
    return 2;
  }

  try {
    if (command === "debug") {
      const snapshot = createRslDebugSnapshot(parseTrace(await io.read(path)));
      io.stdout(json(snapshot));
      return 0;
    }

    const source = await io.read(path);
    const expression = parseRslExpression(source);
    if (command === "validate") {
      const result = validateRslStructure(expression);
      if (!result.valid) {
        for (const diagnostic of result.diagnostics)
          io.stderr(
            `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}\n`,
          );
        return 1;
      }
      io.stdout(
        `valid ${expression.id} nodes=${String(expression.nodes.length)} edges=${String(expression.edges.length)}\n`,
      );
      return 0;
    }
    if (command === "format") {
      if (args.includes("--check") && args.includes("--write")) {
        io.stderr("format cannot combine --check and --write\n");
        return 2;
      }
      const formatted = stringifyRslExpression(expression);
      if (args.includes("--check")) {
        if (source === formatted) return 0;
        io.stderr(`${path} is not canonical RSL YAML\n`);
        return 1;
      }
      if (args.includes("--write")) await io.write(path, formatted);
      else io.stdout(formatted);
      return 0;
    }
    if (command === "visualize") {
      const hasOutputOption = args.includes("-o") || args.includes("--output");
      const output = option(args, "-o", "--output");
      if (hasOutputOption && (output === undefined || output.startsWith("-"))) {
        io.stderr("visualize requires a path after --output or -o\n");
        return 2;
      }
      const result = validateRslStructure(expression);
      if (!result.valid) {
        for (const diagnostic of result.diagnostics)
          io.stderr(
            `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}\n`,
          );
        return 1;
      }
      const mermaid = renderRslMermaid(expression, {
        direction: args.includes("--top-down") ? "TD" : "LR",
      });
      if (output === undefined) io.stdout(mermaid);
      else await io.write(output, mermaid);
      return 0;
    }
    if (command === "inspect") {
      io.stdout(json(inspect(expression)));
      return 0;
    }
    io.stderr(`Unknown command: ${command}\n${usage}`);
    return 2;
  } catch (error) {
    if (error instanceof RslYamlError) {
      io.stderr(`${error.code}: ${error.message}\n`);
      return 1;
    }
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
