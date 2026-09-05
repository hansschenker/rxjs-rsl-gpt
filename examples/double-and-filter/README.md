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

Generate the diagram from [`workflow.rsl.yaml`](workflow.rsl.yaml):

```bash
npm run rsl -- visualize examples/double-and-filter/workflow.rsl.yaml --output examples/double-and-filter/workflow.mmd
```

The generated [`workflow.mmd`](workflow.mmd) renders as:

```mermaid
flowchart LR
  n0["Console<br/>Sink"]
  n1["Double<br/>Pipeline<br/>rxjs.map<br/>worker: workers.double"]
  n2["GreaterThanFour<br/>Pipeline<br/>rxjs.filter<br/>worker: workers.greaterThanFour"]
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
