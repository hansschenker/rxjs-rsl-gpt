import {
  asyncScheduler,
  catchError,
  delay,
  defer,
  filter,
  from,
  ignoreElements,
  interval,
  map,
  of,
  retry,
  scan,
  skip,
  take,
  takeWhile,
  tap,
  timer,
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

function duration(context: CapabilityContext, key: string): number {
  const value = context.parameters[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new TypeError(
      `${context.node.id}.${key} must be a finite non-negative number`,
    );
  return value;
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

export const sourceInterval: RslSourceCapability = (context) =>
  interval(duration(context, "period"), context.scheduler ?? asyncScheduler);

export const sourceTimer: RslSourceCapability = (context) =>
  timer(duration(context, "dueTime"), context.scheduler ?? asyncScheduler);

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

export const operationDelay: RslUnaryOperationCapability = (context) =>
  delay(duration(context, "duration"), context.scheduler ?? asyncScheduler);

function numericParameter(
  context: CapabilityContext,
  key: string,
  fallback: number,
  minimum: number,
): number {
  const value = context.parameters[key] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    throw new TypeError(
      `${context.node.id}.${key} must be a finite number >= ${String(minimum)}`,
    );
  return value;
}

function booleanParameter(
  context: CapabilityContext,
  key: string,
  fallback: boolean,
): boolean {
  const value = context.parameters[key] ?? fallback;
  if (typeof value !== "boolean")
    throw new TypeError(`${context.node.id}.${key} must be boolean`);
  return value;
}

/** Count is the number of resubscriptions after the first failed attempt. */
export const operationRetry: RslUnaryOperationCapability = (context) => {
  const count = integer(context, "count");
  const initialDelay = numericParameter(context, "delay", 0, 0);
  const backoffRate = numericParameter(context, "backoffRate", 1, 1);
  const resetOnSuccess = booleanParameter(context, "resetOnSuccess", false);
  return retry({
    count,
    resetOnSuccess,
    delay: (error, retryCount) =>
      defer(() => {
        const retryDelay = initialDelay * backoffRate ** (retryCount - 1);
        if (!Number.isFinite(retryDelay))
          throw new TypeError(`${context.node.id}.delay overflowed`);
        context.errorPolicy?.retry(retryCount, retryDelay, error);
        return retryDelay === 0
          ? of(null)
          : timer(retryDelay, context.scheduler ?? asyncScheduler);
      }),
  });
};

/** Replace an errored upstream with the Observable returned by a named Worker. */
export const operationCatchError: RslUnaryOperationCapability = (context) =>
  catchError((error, caught) => {
    context.errorPolicy?.recovery(error);
    return from(worker(context)(error, caught) as ObservableInput<unknown>);
  });

export const effectSink: RslSinkCapability = (source, context) =>
  source.pipe(
    tap((value) => {
      worker(context)(value);
    }),
    ignoreElements(),
  );

/** Sink used by the ASL-inspired Handlers form. */
export const handlersSink: RslSinkCapability = (source, context) =>
  source.pipe(
    tap({
      ...(context.handlers?.next === undefined
        ? {}
        : { next: (value) => context.handlers?.next?.(value) }),
      ...(context.handlers?.error === undefined
        ? {}
        : { error: (error) => context.handlers?.error?.(error) }),
      ...(context.handlers?.complete === undefined
        ? {}
        : { complete: () => context.handlers?.complete?.() }),
    }),
    ignoreElements(),
  );

export const observerSink =
  (observer: PartialObserver<unknown>): RslSinkCapability =>
  (source) =>
    source.pipe(tap(observer), ignoreElements());
