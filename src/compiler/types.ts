import type {
  Observable,
  ObservableInput,
  OperatorFunction,
  SchedulerLike,
} from "rxjs";

import type { OperationParameters, RslNode } from "../model/index.js";
import type { ValidSemanticResult } from "../contracts/index.js";
import type { RslTraceObserver } from "./tracing.js";

export type RslRuntimeWorker = (...inputs: readonly unknown[]) => unknown;

export interface RslErrorPolicyReporter {
  retry(retry: number, delay: number, error: unknown): void;
  recovery(error: unknown): void;
}

export interface CapabilityContext {
  readonly node: RslNode;
  readonly parameters: OperationParameters;
  readonly worker?: RslRuntimeWorker;
  /** Scheduler supplied to a time-aware Source or operation capability. */
  readonly scheduler?: SchedulerLike;
  /** Execution-local reporting for retry and recovery policy decisions. */
  readonly errorPolicy?: RslErrorPolicyReporter;
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

export interface RslCompileOptions {
  /** Optional observer for execution-local lifecycle events. */
  readonly trace?: RslTraceObserver;
  /** Supplies execution identities; called once for each subscription. */
  readonly executionId?: () => string;
  /** Supplies trace time. Inject a scheduler's now function for logical time. */
  readonly now?: () => number;
}
