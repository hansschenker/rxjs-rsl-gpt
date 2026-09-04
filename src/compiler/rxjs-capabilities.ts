import {
  defer,
  filter,
  from,
  ignoreElements,
  map,
  scan,
  skip,
  take,
  takeWhile,
  tap,
  type ObservableInput,
  type PartialObserver,
} from "rxjs";

import type { RslValue } from "../model/index.js";
import type {
  CapabilityContext,
  RslSinkCapability,
  RslSourceCapability,
  RslUnaryOperationCapability,
} from "./types.js";

function worker(context: CapabilityContext): (...values: unknown[]) => unknown {
  if (context.worker === undefined)
    throw new TypeError(`Node ${context.node.id} requires a runtime Worker`);
  return context.worker;
}

function integer(context: CapabilityContext, key: string): number {
  const value = context.parameters[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError(
      `${context.node.id}.${key} must be a non-negative integer`,
    );
  return value as number;
}

export const sourceOf: RslSourceCapability = ({ parameters }) => {
  const values = parameters.values;
  if (values === undefined) throw new TypeError("of.values is required");
  return Array.isArray(values)
    ? (values as readonly RslValue[])
    : ([values] as readonly RslValue[]);
};

export const sourceFrom: RslSourceCapability = ({ parameters }) => {
  const values = parameters.values;
  if (!Array.isArray(values) && typeof values !== "string")
    throw new TypeError("from.values must be an array or string");
  return values;
};

export const sourceDefer: RslSourceCapability = (context) =>
  defer(() =>
    from(worker(context)(context.parameters) as ObservableInput<unknown>),
  );

export const operationMap: RslUnaryOperationCapability = (context) =>
  map((value) => worker(context)(value));

export const operationFilter: RslUnaryOperationCapability = (context) =>
  filter((value) => Boolean(worker(context)(value)));

export const operationScan: RslUnaryOperationCapability = (context) =>
  scan(
    (state: unknown, value: unknown) => worker(context)(state, value),
    context.parameters.seed,
  );

export const operationTap: RslUnaryOperationCapability = (context) =>
  tap((value) => {
    worker(context)(value);
  });

export const operationTake: RslUnaryOperationCapability = (context) =>
  take(integer(context, "count"));

export const operationSkip: RslUnaryOperationCapability = (context) =>
  skip(integer(context, "count"));

export const operationTakeWhile: RslUnaryOperationCapability = (context) =>
  takeWhile((value) => Boolean(worker(context)(value)));

export const effectSink: RslSinkCapability = (source, context) =>
  source.pipe(
    tap((value) => {
      worker(context)(value);
    }),
    ignoreElements(),
  );

export const observerSink =
  (observer: PartialObserver<unknown>): RslSinkCapability =>
  (source) =>
    source.pipe(tap(observer), ignoreElements());
