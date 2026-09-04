import {
  combineLatest,
  concat,
  forkJoin,
  merge,
  share,
  shareReplay,
  takeUntil,
  withLatestFrom,
  zip,
  type ShareConfig,
} from "rxjs";

import type {
  CapabilityContext,
  RslMultiInputOperationCapability,
  RslUnaryOperationCapability,
} from "./types.js";

export const operationCombineLatest: RslMultiInputOperationCapability = (
  inputs,
) => combineLatest(inputs);

export const operationForkJoin: RslMultiInputOperationCapability = (inputs) =>
  forkJoin(inputs);

export const operationMerge: RslMultiInputOperationCapability = (inputs) =>
  merge(...inputs);

export const operationConcat: RslMultiInputOperationCapability = (inputs) =>
  concat(...inputs);

export const operationZip: RslMultiInputOperationCapability = (inputs) =>
  zip(...inputs);

export const operationWithLatestFrom: RslMultiInputOperationCapability = (
  inputs,
) => {
  const [source, ...others] = inputs;
  if (source === undefined)
    throw new TypeError("withLatestFrom needs a source");
  return source.pipe(withLatestFrom(...others));
};

export const operationTakeUntil: RslMultiInputOperationCapability = (
  inputs,
) => {
  const [source, notifier] = inputs;
  if (source === undefined || notifier === undefined)
    throw new TypeError("takeUntil needs value and notifier inputs");
  return source.pipe(takeUntil(notifier));
};

function booleanParameter(
  context: CapabilityContext,
  name: string,
  fallback: boolean,
): boolean {
  const value = context.parameters[name];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new TypeError(`${context.node.id}.${name} must be boolean`);
  return value;
}

export const operationShare: RslUnaryOperationCapability = (context) => {
  const config: ShareConfig<unknown> = {
    resetOnError: booleanParameter(context, "resetOnError", true),
    resetOnComplete: booleanParameter(context, "resetOnComplete", true),
    resetOnRefCountZero: booleanParameter(context, "resetOnRefCountZero", true),
  };
  return share(config);
};

export const operationShareReplayOne: RslUnaryOperationCapability = (context) =>
  shareReplay({
    bufferSize: 1,
    refCount: booleanParameter(context, "refCount", true),
  });
