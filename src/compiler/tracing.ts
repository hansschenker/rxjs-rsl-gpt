import { defer, finalize, tap, type Observable } from "rxjs";

import type { ResolvedNode } from "../registry/index.js";
import type { RslCompileOptions } from "./types.js";

export type RslExecutionOutcome = "complete" | "error" | "cancelled";
export type RslNotificationKind = "next" | "error" | "complete";
export type RslSchedulerRole = "operation" | "subscribeOn" | "observeOn";

interface TraceBase {
  readonly sequence: number;
  readonly time: number;
  readonly expressionId: string;
  readonly executionId: string;
}

export type RslTraceEvent =
  | (TraceBase & { readonly kind: "execution.started" })
  | (TraceBase & {
      readonly kind: "scheduler.bound";
      readonly nodeId: string;
      readonly role: RslSchedulerRole;
      readonly schedulerRef: string;
    })
  | (TraceBase & {
      readonly kind: "node.subscribed";
      readonly nodeId: string;
      readonly subscriptionId: string;
    })
  | (TraceBase & {
      readonly kind: "node.notification";
      readonly nodeId: string;
      readonly subscriptionId: string;
      readonly notification: RslNotificationKind;
      readonly value?: unknown;
    })
  | (TraceBase & {
      readonly kind: "node.finalized";
      readonly nodeId: string;
      readonly subscriptionId: string;
      readonly outcome: RslExecutionOutcome;
    })
  | (TraceBase & {
      readonly kind: "execution.finalized";
      readonly outcome: RslExecutionOutcome;
    });

export type RslTraceObserver = (event: RslTraceEvent) => void;
type RslTraceInput = RslTraceEvent extends infer Event
  ? Event extends RslTraceEvent
    ? Omit<Event, keyof TraceBase>
    : never
  : never;

export interface RslTraceRuntime {
  readonly executionId: string;
  emit(event: RslTraceInput): void;
  nextSubscriptionId(nodeId: string): string;
}

/** Create one isolated trace sequence for one workflow subscription. */
export function createTraceRuntime(
  expressionId: string,
  executionId: string,
  options: RslCompileOptions,
): RslTraceRuntime {
  let sequence = 0;
  const subscriptions = new Map<string, number>();
  const now = options.now ?? Date.now;
  return {
    executionId,
    emit(event): void {
      if (options.trace === undefined) return;
      const complete = Object.freeze({
        ...event,
        sequence: sequence++,
        time: now(),
        expressionId,
        executionId,
      }) as RslTraceEvent;
      // Instrumentation cannot alter the workflow's notification protocol.
      try {
        options.trace(complete);
      } catch {
        // Trace observers are deliberately isolated from workflow execution.
      }
    },
    nextSubscriptionId(nodeId): string {
      const ordinal = (subscriptions.get(nodeId) ?? 0) + 1;
      subscriptions.set(nodeId, ordinal);
      return `${executionId}:${nodeId}:${String(ordinal)}`;
    },
  };
}

function schedulerBindings(node: ResolvedNode) {
  const operation = node.schedulers?.operation ?? node.scheduler;
  return [
    ["operation", operation],
    ["subscribeOn", node.schedulers?.subscribeOn],
    ["observeOn", node.schedulers?.observeOn],
  ] as const;
}

/** Trace each actual subscription to a node stream, including cold fan-out. */
export function traceNode<T>(
  source: Observable<T>,
  node: ResolvedNode,
  runtime: RslTraceRuntime,
): Observable<T> {
  return defer(() => {
    const subscriptionId = runtime.nextSubscriptionId(node.node.id);
    let outcome: RslExecutionOutcome = "cancelled";
    runtime.emit({
      kind: "node.subscribed",
      nodeId: node.node.id,
      subscriptionId,
    });
    for (const [role, binding] of schedulerBindings(node))
      if (binding !== undefined)
        runtime.emit({
          kind: "scheduler.bound",
          nodeId: node.node.id,
          role,
          schedulerRef: binding.definition.ref,
        });
    return source.pipe(
      tap({
        next: (value) => {
          runtime.emit({
            kind: "node.notification",
            nodeId: node.node.id,
            subscriptionId,
            notification: "next",
            value,
          });
        },
        error: (value) => {
          outcome = "error";
          runtime.emit({
            kind: "node.notification",
            nodeId: node.node.id,
            subscriptionId,
            notification: "error",
            value,
          });
        },
        complete: () => {
          outcome = "complete";
          runtime.emit({
            kind: "node.notification",
            nodeId: node.node.id,
            subscriptionId,
            notification: "complete",
          });
        },
      }),
      finalize(() => {
        runtime.emit({
          kind: "node.finalized",
          nodeId: node.node.id,
          subscriptionId,
          outcome,
        });
      }),
    );
  });
}

export function traceExecution<T>(
  source: Observable<T>,
  runtime: RslTraceRuntime,
): Observable<T> {
  let outcome: RslExecutionOutcome = "cancelled";
  runtime.emit({ kind: "execution.started" });
  return source.pipe(
    tap({
      error: () => {
        outcome = "error";
      },
      complete: () => {
        outcome = "complete";
      },
    }),
    finalize(() => {
      runtime.emit({ kind: "execution.finalized", outcome });
    }),
  );
}
