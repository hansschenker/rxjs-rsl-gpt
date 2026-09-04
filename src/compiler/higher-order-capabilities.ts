import {
  concatMap,
  exhaustMap,
  from,
  mergeMap,
  switchMap,
  type ObservableInput,
  type OperatorFunction,
} from "rxjs";

import type {
  CapabilityContext,
  RslRuntimeWorker,
  RslUnaryOperationCapability,
} from "./types.js";

export type HigherOrderPolicy = "merge" | "switch" | "concat" | "exhaust";

function worker(context: CapabilityContext): RslRuntimeWorker {
  if (context.worker === undefined)
    throw new TypeError(`Node ${context.node.id} requires a runtime Worker`);
  return context.worker;
}

function inner(
  context: CapabilityContext,
  value: unknown,
  index: number,
): ObservableInput<unknown> {
  return worker(context)(value, index) as ObservableInput<unknown>;
}

function concurrency(context: CapabilityContext): number {
  const value = context.parameters.concurrency;
  if (value === undefined) return Infinity;
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new TypeError(
      `${context.node.id}.concurrency must be a positive integer`,
    );
  return value as number;
}

export function createHigherOrderOperation(
  policy: HigherOrderPolicy,
): RslUnaryOperationCapability {
  return (context): OperatorFunction<unknown, unknown> => {
    if (policy === "merge")
      return mergeMap(
        (value, index) => from(inner(context, value, index)),
        concurrency(context),
      );
    if (policy === "switch")
      return switchMap((value, index) => from(inner(context, value, index)));
    if (policy === "concat")
      return concatMap((value, index) => from(inner(context, value, index)));
    return exhaustMap((value, index) => from(inner(context, value, index)));
  };
}

export const operationMergeMap = createHigherOrderOperation("merge");
export const operationSwitchMap = createHigherOrderOperation("switch");
export const operationConcatMap = createHigherOrderOperation("concat");
export const operationExhaustMap = createHigherOrderOperation("exhaust");
