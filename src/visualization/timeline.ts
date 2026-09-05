import type { RslTraceEvent } from "../compiler/index.js";
import type { RslExpression } from "../model/index.js";
import { validateRslStructure } from "../validation/index.js";
import { createRslDebugSnapshot } from "./debug.js";

function escaped(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", " ");
}

function displayed(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

type NotificationEvent = Extract<
  RslTraceEvent,
  { readonly kind: "node.notification" }
>;

function isNotification(event: RslTraceEvent): event is NotificationEvent {
  return event.kind === "node.notification";
}

function requiredAlias(aliases: ReadonlyMap<string, string>, nodeId: string) {
  const alias = aliases.get(nodeId);
  if (alias === undefined) throw new TypeError(`Missing node alias: ${nodeId}`);
  return alias;
}

function nodeLabel(node: RslExpression["nodes"][number]): string {
  const operation = node.kind === "sink" ? "subscribe" : node.operation.ref;
  const expression = node.extensions?.["x-jsonata"];
  return [
    node.id,
    operation,
    ...(node.worker === undefined ? [] : [node.worker.worker.ref]),
    ...(typeof expression === "string" ? [`expression: ${expression}`] : []),
  ]
    .map(escaped)
    .join("<br/>");
}

/** Render one node's observed notification timeline beside its RSL pipeline. */
export function renderRslTimelineMermaid(
  expression: RslExpression,
  events: readonly RslTraceEvent[],
  declaredNodeId?: string,
): string {
  const structure = validateRslStructure(expression);
  if (!structure.valid)
    throw new TypeError("Timeline rendering requires a valid RSL graph");
  createRslDebugSnapshot(events);

  const nodeId =
    declaredNodeId ?? expression.nodes.find((node) => node.kind === "sink")?.id;
  if (
    nodeId === undefined ||
    !expression.nodes.some((node) => node.id === nodeId)
  )
    throw new TypeError(`Timeline node does not exist: ${nodeId ?? "<none>"}`);

  const notifications = events
    .filter(isNotification)
    .filter((event) => event.nodeId === nodeId);
  if (notifications.length === 0)
    throw new TypeError(`Trace contains no notifications for ${nodeId}`);

  const orderedNodes = structure.topologicalOrder.map((id) => {
    const node = expression.nodes.find((candidate) => candidate.id === id);
    if (node === undefined) throw new TypeError(`Missing node: ${id}`);
    return node;
  });
  const aliasById = new Map(
    orderedNodes.map((node, index) => [node.id, `p${String(index)}`]),
  );
  const values = notifications.filter((event) => event.notification === "next");
  const lines = [
    "flowchart LR",
    '  subgraph pipeline["RSL pipeline"]',
    "    direction TB",
  ];
  for (const node of orderedNodes) {
    const alias = requiredAlias(aliasById, node.id);
    lines.push(`    ${alias}["${nodeLabel(node)}"]`);
  }
  for (const edge of expression.edges) {
    const from = aliasById.get(edge.from.node);
    const to = aliasById.get(edge.to.node);
    if (from !== undefined && to !== undefined)
      lines.push(`    ${from} --> ${to}`);
  }
  lines.push(
    "  end",
    `  subgraph execution["${escaped(nodeId)} execution"]`,
    "    direction TB",
    '    subgraph emitted["Emitted values"]',
    "      direction LR",
  );
  values.forEach((event, index) => {
    lines.push(
      `      v${String(index)}(("${escaped(displayed(event.value))}"))`,
    );
  });
  if (values.length > 1)
    lines.push(
      `      ${values.map((_, index) => `v${String(index)}`).join(" ~~~ ")}`,
    );
  lines.push("    end");
  notifications.forEach((event, index) => {
    const value =
      event.notification === "next" || event.notification === "error"
        ? displayed(event.value)
        : "-";
    lines.push(
      `    e${String(index)}["${escaped(`${String(event.time)} ms + ${event.notification} + ${value}`)}"]`,
    );
  });
  if (notifications.length > 1)
    lines.push(
      `    ${notifications.map((_, index) => `e${String(index)}`).join(" --> ")}`,
    );
  lines.push("  end");
  const target = aliasById.get(nodeId);
  if (target !== undefined) lines.push(`  ${target} -. notifications .-> e0`);
  lines.push(
    "  classDef source fill:#e8f5e9,stroke:#2e7d32",
    "  classDef pipelineNode fill:#e3f2fd,stroke:#1565c0",
    "  classDef sink fill:#fff3e0,stroke:#ef6c00",
  );
  orderedNodes.forEach((node) => {
    const alias = requiredAlias(aliasById, node.id);
    const className = node.kind === "pipeline" ? "pipelineNode" : node.kind;
    lines.push(`  class ${alias} ${className}`);
  });
  return `${lines.join("\n")}\n`;
}
