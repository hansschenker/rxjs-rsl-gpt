import type { RslTraceEvent } from "../compiler/index.js";
import type { RslDebugNodeSnapshot, RslDebugSnapshot } from "./types.js";

interface MutableNode {
  subscriptions: Set<string>;
  finalized: Set<string>;
  nextCount: number;
  lastNotification?: "next" | "error" | "complete";
  lastValue?: unknown;
  outcomes: { complete: number; error: number; cancelled: number };
  schedulers: Set<string>;
  retries: number;
  recoveries: number;
}

function mutableNode(): MutableNode {
  return {
    subscriptions: new Set(),
    finalized: new Set(),
    nextCount: 0,
    outcomes: { complete: 0, error: 0, cancelled: 0 },
    schedulers: new Set(),
    retries: 0,
    recoveries: 0,
  };
}

/** Fold one execution's ordered trace into a stable debugger snapshot. */
export function createRslDebugSnapshot(
  events: readonly RslTraceEvent[],
): RslDebugSnapshot {
  const first = events[0];
  if (first === undefined)
    throw new TypeError("A debug snapshot needs trace events");
  const executionId = first.executionId;
  const expressionId = first.expressionId;
  if (
    events.some(
      (event) =>
        event.executionId !== executionId ||
        event.expressionId !== expressionId,
    )
  )
    throw new TypeError("A debug snapshot can contain only one execution");
  for (let index = 1; index < events.length; index += 1)
    if ((events[index]?.sequence ?? -1) <= (events[index - 1]?.sequence ?? -1))
      throw new TypeError("Trace events must be in increasing sequence order");

  const nodes = new Map<string, MutableNode>();
  const node = (nodeId: string) => {
    const existing = nodes.get(nodeId);
    if (existing !== undefined) return existing;
    const created = mutableNode();
    nodes.set(nodeId, created);
    return created;
  };
  let status: RslDebugSnapshot["status"] = "running";
  for (const event of events) {
    if (event.kind === "execution.finalized") status = event.outcome;
    else if (event.kind === "node.subscribed")
      node(event.nodeId).subscriptions.add(event.subscriptionId);
    else if (event.kind === "scheduler.bound")
      node(event.nodeId).schedulers.add(`${event.role}:${event.schedulerRef}`);
    else if (event.kind === "node.notification") {
      const current = node(event.nodeId);
      current.lastNotification = event.notification;
      if (event.notification === "next") {
        current.nextCount += 1;
        current.lastValue = event.value;
      } else if (event.notification === "error")
        current.lastValue = event.value;
    } else if (event.kind === "node.finalized") {
      const current = node(event.nodeId);
      current.finalized.add(event.subscriptionId);
      current.outcomes[event.outcome] += 1;
    } else if (event.kind === "error.retry") node(event.nodeId).retries += 1;
    else if (event.kind === "error.recovery")
      node(event.nodeId).recoveries += 1;
  }

  const snapshots: RslDebugNodeSnapshot[] = [...nodes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([nodeId, value]) =>
      Object.freeze({
        nodeId,
        subscriptions: value.subscriptions.size,
        activeSubscriptions: value.subscriptions.size - value.finalized.size,
        nextCount: value.nextCount,
        ...(value.lastNotification === undefined
          ? {}
          : { lastNotification: value.lastNotification }),
        ...(value.lastValue === undefined
          ? {}
          : { lastValue: value.lastValue }),
        outcomes: Object.freeze({ ...value.outcomes }),
        schedulers: Object.freeze([...value.schedulers].sort()),
        retries: value.retries,
        recoveries: value.recoveries,
      }),
    );
  return Object.freeze({
    expressionId,
    executionId,
    status,
    firstSequence: first.sequence,
    lastSequence: events.at(-1)?.sequence ?? first.sequence,
    eventCount: events.length,
    nodes: Object.freeze(snapshots),
  });
}
