# RSL v0.1 conformance matrix

This matrix is created before the compiler so implementation work cannot silently redefine the language.

Status values:

- **scaffold** — test location exists, semantics not implemented;
- **partial** — some normative cases implemented;
- **conformant** — all mapped MUST rules have passing positive and negative evidence;
- **excluded** — explicitly outside v0.1 with a documented reason.

| Specification area         | Required evidence                                                                  | Planned milestone      | Status     |
| -------------------------- | ---------------------------------------------------------------------------------- | ---------------------- | ---------- |
| Node polarity              | Source has no inputs; Pipeline has inputs and outputs; Sink has no outputs         | RSL 06, RSL 08         | conformant |
| Graph cardinality          | One or more Sources, zero or more Pipelines, one or more Sinks                     | RSL 06, RSL 08         | conformant |
| Explicit ports and edges   | Endpoints exist and required ports are connected                                   | RSL 06, RSL 08         | conformant |
| Type-compatible edges      | Every dataflow edge carries a compatible TypeRef                                   | RSL 10                 | conformant |
| DAG invariant              | Directed cycles are rejected                                                       | RSL 08                 | conformant |
| Reachability               | Every node is reachable from a Source and can reach a Sink                         | RSL 08                 | conformant |
| Laziness                   | Compile invokes no Source or Worker                                                | RSL 11                 | conformant |
| Subscription boundary      | Each subscription creates an independent execution by default                      | RSL 11                 | conformant |
| Notification protocol      | Zero or more next values followed by at most one terminal notification             | RSL 11                 | conformant |
| Cancellation               | Teardown stops participation and does not emit complete                            | RSL 11, RSL 15         | conformant |
| Execution-local state      | Reducer, coordination, inner state, and trace identity are not shared implicitly   | RSL 11–RSL 15          | conformant |
| Multiple Sources           | A multi-input Pipeline can coordinate independently declared Sources               | RSL 12                 | conformant |
| Multiple Sinks             | Terminal consumers follow declared topology and sharing                            | RSL 12                 | conformant |
| Sharing                    | Fan-out does not imply sharing; sharing and reset policies are explicit            | RSL 12                 | conformant |
| Operator/Worker separation | Operators orchestrate and Workers compute                                          | RSL 09, RSL 11, RSL 13 | conformant |
| Worker contracts           | Category, input, output, purity, and Observable result are validated               | RSL 09, RSL 10         | conformant |
| Higher-order policies      | merge/switch/concat/exhaust produce distinct traces                                | RSL 13                 | conformant |
| Scheduler references       | SchedulerRef resolves without embedding runtime objects in YAML                    | RSL 09, RSL 14         | conformant |
| Logical time               | Virtual and physical schedulers preserve semantic ordering                         | RSL 14                 | conformant |
| Equal-time order           | Scheduled actions use deterministic logical-time sequence order                    | RSL 14                 | conformant |
| Scheduled cancellation     | An execution cancels only its owned actions                                        | RSL 14                 | conformant |
| Deterministic YAML         | Restricted syntax parses and serializes canonically                                | RSL 07                 | conformant |
| No YAML execution          | Parsing invokes no runtime reference                                               | RSL 07                 | conformant |
| Reference resolution       | Missing, duplicate, and wrong-category references fail                             | RSL 09                 | conformant |
| Error recovery             | Retry and recovery scopes preserve cancellation and typing                         | RSL 16                 | conformant |
| Trace protocol             | Lifecycle, notifications, scheduling, sharing, and teardown correlate by identity  | RSL 15                 | conformant |
| Visualization              | Mermaid is deterministic and introduces no topology                                | RSL 17                 | conformant |
| CLI developer workflow     | Static commands compose public APIs, use stable output, and never execute workflow | RSL 18                 | conformant |

## Evidence requirements

Each row reaching **conformant** must link to:

1. the exact normative clause;
2. at least one valid fixture or positive test;
3. at least one invalid fixture or negative test where rejection is meaningful;
4. runtime notification or teardown traces where static output alone is insufficient.
