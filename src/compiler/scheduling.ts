import {
  observeOn,
  subscribeOn,
  type Observable,
  type SchedulerLike,
} from "rxjs";

import type { ResolvedNode, ResolvedReference } from "../registry/index.js";
import { RslCompilerError } from "./diagnostic.js";

function scheduler(
  resolved: ResolvedReference<"scheduler"> | undefined,
  node: ResolvedNode,
  role: string,
): SchedulerLike | undefined {
  if (resolved === undefined) return undefined;
  const value = resolved.definition.value as Partial<SchedulerLike> | undefined;
  if (
    value === undefined ||
    typeof value.schedule !== "function" ||
    typeof value.now !== "function"
  )
    throw new RslCompilerError(
      "CMP-005_INVALID_SCHEDULER",
      `Runtime ${role} scheduler for ${node.node.id} is not SchedulerLike`,
      node.node.id,
    );
  return value as SchedulerLike;
}

export function assertRuntimeSchedulers(node: ResolvedNode): void {
  scheduler(node.schedulers?.operation ?? node.scheduler, node, "operation");
  scheduler(node.schedulers?.subscribeOn, node, "SubscribeOn");
  scheduler(node.schedulers?.observeOn, node, "ObserveOn");
}

export function operationScheduler(
  node: ResolvedNode,
): SchedulerLike | undefined {
  return scheduler(
    node.schedulers?.operation ?? node.scheduler,
    node,
    "operation",
  );
}

/** Apply subscription scheduling first, then notification scheduling. */
export function applyNodeScheduling<T>(
  source: Observable<T>,
  node: ResolvedNode,
): Observable<T> {
  const subscriptionScheduler = scheduler(
    node.schedulers?.subscribeOn,
    node,
    "SubscribeOn",
  );
  const notificationScheduler = scheduler(
    node.schedulers?.observeOn,
    node,
    "ObserveOn",
  );
  const subscribed =
    subscriptionScheduler === undefined
      ? source
      : source.pipe(subscribeOn(subscriptionScheduler));
  return notificationScheduler === undefined
    ? subscribed
    : subscribed.pipe(observeOn(notificationScheduler));
}
