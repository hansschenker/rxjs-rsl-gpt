# Double and filter visualization

This RSL graph represents the following RxJS pipeline:

```ts
from([1, 2, 3, 4, 5])
  .pipe(
    map((n) => n * 2),
    filter((n) => n > 4),
  )
  .subscribe((n) => console.log(n));
```

RSL replaces the inline callbacks with the named Workers `workers.double`, `workers.greaterThanFour`, and `workers.log`. The resulting values are `6`, `8`, and `10`.

The `x-jsonata` metadata records a declarative expression for visualization while the registered Worker remains the executable implementation:

```yaml
x-jsonata: "{% $ * 2 %}"
```

Generate the diagram from [`workflow.rsl.yaml`](workflow.rsl.yaml):

```bash
npm run rsl -- visualize examples/double-and-filter/workflow.rsl.yaml --output examples/double-and-filter/workflow.mmd
```

The generated [`workflow.mmd`](workflow.mmd) renders as:

```mermaid
flowchart LR
  n0["Console<br/>Sink<br/>expression: {% $ %}"]
  n1["Double<br/>Pipeline<br/>rxjs.map<br/>worker: workers.double<br/>expression: {% $ * 2 %}"]
  n2["GreaterThanFour<br/>Pipeline<br/>rxjs.filter<br/>worker: workers.greaterThanFour<br/>expression: {% $ &gt; 4 %}"]
  n3["Numbers<br/>Source<br/>rxjs.from"]
  n1 -->|"value + value<br/>number"| n2
  n2 -->|"value + value<br/>number"| n0
  n3 -->|"value + value<br/>number"| n1
  class n0 sink
  class n1 pipeline
  class n2 pipeline
  class n3 source
  classDef source fill:#e8f5e9,stroke:#2e7d32
  classDef pipeline fill:#e3f2fd,stroke:#1565c0
  classDef sink fill:#fff3e0,stroke:#ef6c00
```

## Execution timeline

The saved [`trace.json`](trace.json) adds values, logical time, and terminal notifications to the graph:

```bash
npm run rsl -- visualize examples/double-and-filter/workflow.rsl.yaml --trace examples/double-and-filter/trace.json --node Console --output examples/double-and-filter/execution-timeline.mmd
```

[`execution-timeline.mmd`](execution-timeline.mmd) renders as:

```mermaid
flowchart LR
  subgraph pipeline["RSL pipeline"]
    direction TB
    p0["Numbers<br/>rxjs.from"]
    p1["Double<br/>rxjs.map<br/>workers.double<br/>expression: {% $ * 2 %}"]
    p2["GreaterThanFour<br/>rxjs.filter<br/>workers.greaterThanFour<br/>expression: {% $ &gt; 4 %}"]
    p3["Console<br/>subscribe<br/>expression: {% $ %}"]
    p0 --> p1
    p1 --> p2
    p2 --> p3
  end
  subgraph execution["Console execution"]
    direction TB
    subgraph emitted["Emitted values"]
      direction LR
      v0(("6"))
      v1(("8"))
      v2(("10"))
      v0 ~~~ v1 ~~~ v2
    end
    e0["2 ms + next + 6"]
    e1["3 ms + next + 8"]
    e2["3 ms + next + 10"]
    e3["3 ms + complete + -"]
    e0 --> e1 --> e2 --> e3
  end
  p3 -. notifications .-> e0
  classDef source fill:#e8f5e9,stroke:#2e7d32
  classDef pipelineNode fill:#e3f2fd,stroke:#1565c0
  classDef sink fill:#fff3e0,stroke:#ef6c00
  class p0 source
  class p1 pipelineNode
  class p2 pipelineNode
  class p3 sink
```
