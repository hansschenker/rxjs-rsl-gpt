import type {
  RslExecutionOutcome,
  RslNotificationKind,
} from "../compiler/index.js";

export interface RslMermaidOptions {
  readonly direction?: "LR" | "TD";
  readonly showTypes?: boolean;
  readonly showWorkers?: boolean;
  readonly showSchedulers?: boolean;
  readonly showPolicies?: boolean;
}

export interface RslDebugNodeSnapshot {
  readonly nodeId: string;
  readonly subscriptions: number;
  readonly activeSubscriptions: number;
  readonly nextCount: number;
  readonly lastNotification?: RslNotificationKind;
  readonly lastValue?: unknown;
  readonly outcomes: Readonly<Record<RslExecutionOutcome, number>>;
  readonly schedulers: readonly string[];
  readonly retries: number;
  readonly recoveries: number;
}

export interface RslDebugSnapshot {
  readonly expressionId: string;
  readonly executionId: string;
  readonly status: "running" | RslExecutionOutcome;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly eventCount: number;
  readonly nodes: readonly RslDebugNodeSnapshot[];
}
