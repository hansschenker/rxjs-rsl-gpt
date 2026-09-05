import type { RslExpression, RslNode, TypeRef } from "../model/index.js";
import type { RslMermaidOptions } from "./types.js";

function typeName(type: TypeRef): string {
  if (type.kind === "primitive") return type.name;
  if (type.kind === "named") return type.ref;
  if (type.kind === "array") return `readonly ${typeName(type.items)}[]`;
  if (type.kind === "tuple")
    return `readonly [${type.items.map(typeName).join(", ")}]`;
  if (type.kind === "record")
    return `{ ${Object.entries(type.fields)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}: ${typeName(value)}`)
      .join("; ")} }`;
  if (type.kind === "union") return type.members.map(typeName).join(" | ");
  if (type.kind === "generic")
    return `${type.ref}<${type.arguments.map(typeName).join(", ")}>`;
  return `Observable<${typeName(type.value)}>`;
}

function escaped(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", " ");
}

function schedulerLines(node: RslNode): readonly string[] {
  const scheduler = node.scheduler;
  if (scheduler === undefined) return [];
  const operation = scheduler.operation ?? scheduler.scheduler;
  return [
    ...(operation === undefined ? [] : [`clock: ${operation.ref}`]),
    ...(scheduler.subscribeOn === undefined
      ? []
      : [`subscribe: ${scheduler.subscribeOn.ref}`]),
    ...(scheduler.observeOn === undefined
      ? []
      : [`observe: ${scheduler.observeOn.ref}`]),
  ];
}

function nodeLabel(
  node: RslNode,
  options: Required<RslMermaidOptions>,
): string {
  const lines = [
    node.id,
    `${node.kind.charAt(0).toUpperCase()}${node.kind.slice(1)}`,
  ];
  if (node.kind !== "sink") lines.push(node.operation.ref);
  if (options.showWorkers && node.worker !== undefined)
    lines.push(`worker: ${node.worker.worker.ref}`);
  const expression = node.extensions?.["x-jsonata"];
  if (typeof expression === "string") lines.push(`expression: ${expression}`);
  if (options.showPolicies && node.kind === "pipeline") {
    if (node.concurrency !== undefined)
      lines.push(
        `policy: ${node.concurrency.policy} / ${String(node.concurrency.limit)}`,
      );
    if (node.operation.ref === "rxjs.retry") lines.push("policy: retry");
    if (node.operation.ref === "rxjs.catchError") lines.push("policy: recover");
  }
  if (options.showSchedulers) lines.push(...schedulerLines(node));
  return lines.map(escaped).join("<br/>");
}

function edgeLabel(
  expression: RslExpression,
  edge: RslExpression["edges"][number],
  showTypes: boolean,
): string {
  const source = expression.nodes
    .find((node) => node.id === edge.from.node)
    ?.outputs.find((port) => port.id === edge.from.port);
  // ASCII-only separator keeps generated labels compatible with Mermaid editors.
  const ports = `${edge.from.port} + ${edge.to.port}`;
  return escaped(
    showTypes && source !== undefined
      ? `${ports}<br/>${typeName(source.type)}`
      : ports,
  ).replace("&lt;br/&gt;", "<br/>");
}

/** Deterministically project the declared graph into Mermaid flowchart text. */
export function renderRslMermaid(
  expression: RslExpression,
  declaredOptions: RslMermaidOptions = {},
): string {
  const options: Required<RslMermaidOptions> = {
    direction: declaredOptions.direction ?? "LR",
    showTypes: declaredOptions.showTypes ?? true,
    showWorkers: declaredOptions.showWorkers ?? true,
    showSchedulers: declaredOptions.showSchedulers ?? true,
    showPolicies: declaredOptions.showPolicies ?? true,
  };
  const nodes = [...expression.nodes].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length)
    throw new TypeError("Mermaid rendering requires unique node identities");
  const aliases = new Map(
    nodes.map((node, index) => [node.id, `n${String(index)}`]),
  );
  const edges = [...expression.edges].sort((left, right) =>
    `${left.from.node}\u0000${left.from.port}\u0000${left.to.node}\u0000${left.to.port}`.localeCompare(
      `${right.from.node}\u0000${right.from.port}\u0000${right.to.node}\u0000${right.to.port}`,
    ),
  );
  const lines = [`flowchart ${options.direction}`];
  for (const node of nodes) {
    const alias = aliases.get(node.id);
    if (alias === undefined) throw new TypeError(`Missing node: ${node.id}`);
    lines.push(`  ${alias}["${nodeLabel(node, options)}"]`);
  }
  for (const edge of edges) {
    const from = aliases.get(edge.from.node);
    const to = aliases.get(edge.to.node);
    if (from === undefined || to === undefined)
      throw new TypeError(
        `Mermaid edge references a missing node: ${edge.from.node} -> ${edge.to.node}`,
      );
    lines.push(
      `  ${from} -->|"${edgeLabel(expression, edge, options.showTypes)}"| ${to}`,
    );
  }
  for (const node of nodes) {
    const alias = aliases.get(node.id);
    if (alias === undefined) throw new TypeError(`Missing node: ${node.id}`);
    lines.push(`  class ${alias} ${node.kind}`);
  }
  lines.push(
    "  classDef source fill:#e8f5e9,stroke:#2e7d32",
    "  classDef pipeline fill:#e3f2fd,stroke:#1565c0",
    "  classDef sink fill:#fff3e0,stroke:#ef6c00",
  );
  return `${lines.join("\n")}\n`;
}
