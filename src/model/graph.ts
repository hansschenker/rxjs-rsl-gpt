import type {
  OperationParameters,
  OperationRef,
  SchedulerBinding,
  WorkerBinding,
} from "./reference.js";
import type { Located } from "./source-location.js";
import type { PortTypeRef } from "./type-ref.js";
import type { NonEmptyReadonlyArray, RslValue } from "./value.js";

export interface InputPort extends Located {
  readonly direction: "input";
  readonly id: string;
  readonly type: PortTypeRef;
}

export interface OutputPort extends Located {
  readonly direction: "output";
  readonly id: string;
  readonly type: PortTypeRef;
}

export interface OutputPortAddress {
  readonly direction: "output";
  readonly node: string;
  readonly port: string;
}

export interface InputPortAddress {
  readonly direction: "input";
  readonly node: string;
  readonly port: string;
}

export interface Edge extends Located {
  readonly from: OutputPortAddress;
  readonly to: InputPortAddress;
}

export type ExtensionKey = `x-${string}`;
export type Extensions = Readonly<Partial<Record<ExtensionKey, RslValue>>>;

interface NodeBase<Kind extends string> extends Located {
  readonly kind: Kind;
  readonly id: string;
  readonly operation: OperationRef;
  readonly parameters?: OperationParameters;
  readonly worker?: WorkerBinding;
  readonly scheduler?: SchedulerBinding;
  readonly extensions?: Extensions;
}

export interface SourceNode extends NodeBase<"source"> {
  readonly inputs: readonly [];
  readonly outputs: NonEmptyReadonlyArray<OutputPort>;
}

export interface PipelineNode extends NodeBase<"pipeline"> {
  readonly inputs: NonEmptyReadonlyArray<InputPort>;
  readonly outputs: NonEmptyReadonlyArray<OutputPort>;
}

export interface SinkNode extends NodeBase<"sink"> {
  readonly inputs: NonEmptyReadonlyArray<InputPort>;
  readonly outputs: readonly [];
}

export type RslNode = SourceNode | PipelineNode | SinkNode;

export interface RslExpression extends Located {
  readonly kind: "rsl-expression";
  readonly version: "0.1";
  readonly id: string;
  readonly nodes: NonEmptyReadonlyArray<RslNode>;
  readonly edges: readonly Edge[];
  readonly extensions?: Extensions;
}
