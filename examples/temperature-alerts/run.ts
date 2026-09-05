import { readFile } from "node:fs/promises";

import {
  compileRsl,
  createRslRegistries,
  createRslRegistry,
  handlersSink,
  operationFilter,
  operationMap,
  sourceFrom,
  type NodeOperationContract,
  type TypeRef,
  type WorkerContract,
} from "../../src/index.js";

const numberType = { kind: "primitive", name: "number" } as const;
const booleanType = { kind: "primitive", name: "boolean" } as const;
const unknownType = { kind: "primitive", name: "unknown" } as const;
const voidType = { kind: "primitive", name: "void" } as const;

const noWorker = (inputs: number, outputs: number): NodeOperationContract => ({
  inputArity: { min: inputs, max: inputs },
  outputArity: { min: outputs, max: outputs },
});

const unaryWorker = (
  category: "transformation" | "predicate",
  output: TypeRef,
): NodeOperationContract => ({
  inputArity: { min: 1, max: 1 },
  outputArity: { min: 1, max: 1 },
  worker: {
    required: true,
    categories: [category],
    purity: "pure",
    inputArity: { min: 1, max: 1 },
  },
  constraints: [
    {
      source: { kind: "node-input", index: 0 },
      target: { kind: "worker-input", index: 0 },
      relation: "equal",
    },
    ...(category === "transformation"
      ? [
          {
            source: { kind: "worker-output" } as const,
            target: { kind: "node-output", index: 0 } as const,
            relation: "equal" as const,
          },
        ]
      : [
          {
            source: { kind: "node-input", index: 0 } as const,
            target: { kind: "node-output", index: 0 } as const,
            relation: "equal" as const,
          },
          {
            source: { kind: "worker-output" } as const,
            target: { kind: "type", type: output } as const,
            relation: "equal" as const,
          },
        ]),
  ],
});

const workerContract = (
  category: WorkerContract["category"],
  inputs: WorkerContract["inputs"],
  output: TypeRef,
  purity: WorkerContract["purity"],
): WorkerContract => ({ category, inputs, output, purity });

const registries = createRslRegistries({
  sources: createRslRegistry("source", [
    {
      category: "source",
      ref: "rxjs.from",
      value: sourceFrom,
      contract: noWorker(0, 1),
    },
  ]),
  operations: createRslRegistry("operation", [
    {
      category: "operation",
      ref: "rxjs.map",
      value: operationMap,
      contract: unaryWorker("transformation", numberType),
    },
    {
      category: "operation",
      ref: "rxjs.filter",
      value: operationFilter,
      contract: unaryWorker("predicate", booleanType),
    },
  ]),
  sinks: createRslRegistry("sink", [
    {
      category: "sink",
      ref: "rsl.handlers",
      value: handlersSink,
      contract: noWorker(1, 0),
    },
  ]),
  workers: createRslRegistry<"worker", unknown>("worker", [
    {
      category: "worker",
      ref: "workers.toFahrenheit",
      value: (celsius: number) => (celsius * 9) / 5 + 32,
      contract: workerContract(
        "transformation",
        [numberType],
        numberType,
        "pure",
      ),
    },
    {
      category: "worker",
      ref: "workers.isHot",
      value: (fahrenheit: number) => fahrenheit >= 80,
      contract: workerContract("predicate", [numberType], booleanType, "pure"),
    },
    {
      category: "worker",
      ref: "workers.printAlert",
      value: (fahrenheit: number) => {
        console.log(`Hot: ${fahrenheit.toFixed(1)} °F`);
      },
      contract: workerContract("effect", [numberType], voidType, "effectful"),
    },
    {
      category: "worker",
      ref: "workers.printError",
      value: (error: unknown) => {
        console.error("Temperature error:", error);
      },
      contract: workerContract("effect", [unknownType], voidType, "effectful"),
    },
    {
      category: "worker",
      ref: "workers.printComplete",
      value: () => {
        console.log("Temperature stream complete");
      },
      contract: workerContract("effect", [voidType], voidType, "effectful"),
    },
  ]),
});

const yaml = await readFile(
  new URL("workflow.rsl.yaml", import.meta.url),
  "utf8",
);
const workflow = compileRsl(yaml, registries);

console.log("RSL compiled to a cold RxJS Observable; subscribing now.");
workflow.definition.subscribe();
