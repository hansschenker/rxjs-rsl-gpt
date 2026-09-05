import type {
  Observable,
  ObservableInput,
  OperatorFunction,
  SchedulerLike,
} from "rxjs";

import type { OperationParameters, RslNode } from "../model/index.js";
import type { ValidSemanticResult } from "../contracts/index.js";

export type RslRuntimeWorker = (...inputs: readonly unknown[]) => unknown;

export interface CapabilityContext {
  readonly node: RslNode;
  readonly parameters: OperationParameters;
  readonly worker?: RslRuntimeWorker;
  /** Scheduler supplied to a time-aware Source or operation capability. */
  readonly scheduler?: SchedulerLike;
  readonly handlers?: {
    readonly next?: RslRuntimeWorker;
    readonly error?: RslRuntimeWorker;
    readonly complete?: RslRuntimeWorker;
  };
}

/** Called once per subscription to activate a cold Source execution. */
export type RslSourceCapability = (
  context: CapabilityContext,
) => ObservableInput<unknown>;

/** Called once per subscription to create execution-local operator state. */
export type RslUnaryOperationCapability = (
  context: CapabilityContext,
) => OperatorFunction<unknown, unknown>;

/** Coordinates input streams in declared port order. */
export type RslMultiInputOperationCapability = (
  inputs: readonly Observable<unknown>[],
  context: CapabilityContext,
) => Observable<unknown>;

/** Converts the final value stream into a completion/error-only Sink stream. */
export type RslSinkCapability = (
  source: Observable<unknown>,
  context: CapabilityContext,
) => Observable<never>;

export interface CompiledRslWorkflow {
  readonly kind: "compiled-rsl-workflow";
  readonly expressionId: string;
  readonly definition: Observable<never>;
  readonly semanticEvidence: ValidSemanticResult;
}
