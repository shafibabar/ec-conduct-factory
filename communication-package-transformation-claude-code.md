# Communication Package Transformation — Claude Code Implementation Brief

## 1. Objective

Implement the visual representation of the **communication package** as it travels through the existing Conduct Visualization assembly line.

The goal is to make the viewer perceive **one persistent physical communication package** moving through the system and progressively changing as each software component processes it.

This is not a request to redesign the existing machines, floor, assembly line, camera, lighting, or overall visual language.

Work within the existing implementation.

The package must feel like a physical object moving through a coherent industrial system.

The central visual principle is:

> **The package is persistent. Its state evolves through visible physical transformation.**

Never make the package appear to be destroyed and replaced by a completely different object at each stage.

---

# 2. Source of Truth

Use the available project files and existing implementation as the source of truth.

Priority order when information conflicts:

1. Existing implementation/code
2. `system-explainer-input.md`
3. Component relationship map
4. This implementation brief
5. Reasonable inference only when the above do not establish the behaviour

Do not invent business behaviour.

The relationship map establishes actual Kafka, REST, storage, and external-service relationships. Use it to understand how the package moves and what derivative records are created.

Where the source does not define a visual transformation, choose the **simplest physical transformation that communicates the established software state change**.

---

# 3. Core Concept: One Persistent Package

Create or adapt a persistent communication-package entity.

The package should have:

- stable identity
- stable outer physical form
- physical payload
- visible metadata/state elements
- ability to acquire new components
- ability to remove or compress components
- ability to temporarily expose internal components
- ability to attach derived information
- ability to temporarily dispatch a processing representation
- ability to receive and incorporate a returned result

Do not implement the journey as:

```text
rawObject.visible = false
qualifiedObject.visible = true
evaluatedObject.visible = false
alertObject.visible = true
```

Instead:

```text
onePackage
    ↓
mutatePackageState()
    ↓
animatePhysicalTransformation()
```

The same package instance should survive the entire journey wherever the actual system semantics represent the same communication.

Temporary objects are allowed when they represent a genuine processing mechanism, such as:

- extracted content
- a fingerprint
- an external Cognition request
- an audit receipt

But these must visibly derive from or relate to the persistent package.

---

# 4. Package State Model

Establish an explicit state model before implementing animations.

Recommended conceptual states:

```text
RAW
INGESTED
QUALIFIED
EVALUATED
SURVEILLED
SAMPLED
ALERTED
ECHO_EVALUATED
INDEX_READY
INDEXED
TERMINATED
```

These are **states of the same package**, not separate package objects.

Create a state model that allows the visual representation to evolve.

At minimum track:

```text
packageId
currentState

identity
tenant
windowToken

payloadState
metadataState

qualifications
pipelineIds

policyEvaluations
surveillanceVerdict

samplingDecision

alertState
enrichmentState

echoState

indexState

terminalState
```

Use the actual project data model where one exists. Do not invent fields that are presented as factual system fields if they are not supported by the source.

The above is a visual/state-modeling guide.

---

# 5. Transformation Contract

Every stage must follow the same animation lifecycle:

```text
BEFORE
  ↓
APPROACH
  ↓
ENGAGE
  ↓
PREPARE
  ↓
PROCESS
  ↓
STATE MUTATION
  ↓
INCORPORATE
  ↓
RELEASE
  ↓
AFTER
```

Never use:

```text
BEFORE
  ↓
instant mesh replacement
  ↓
AFTER
```

The transformation itself must be visible.

The viewer should be able to pause during the animation and understand:

> "The package is currently being processed."

Each transformation should have a meaningful beginning, middle, and end.

---

# 6. Physical Orientation Contract

All package geometry and transformation mechanisms must exist in the same world coordinate system as the existing floor, conveyor, and machinery.

Do not use camera-relative orientation for physical objects.

Do not independently rotate package geometry toward the camera.

The package must physically sit on the conveyor.

For every interaction point determine:

```text
machine interaction point
machine local axis
conveyor tangent
package forward axis
package up axis
entry orientation
exit orientation
```

The package's forward axis follows the local conveyor direction.

When the conveyor curves:

```text
position = curve(t)
orientation = tangent-based orientation
```

When entering a machine:

```text
package orientation → machine intake orientation
```

When leaving:

```text
package orientation → downstream conveyor orientation
```

Interpolate both position and orientation.

Never snap orientation unless the actual machine mechanism explicitly rotates the package.

All attached transformation elements must inherit the package/world transform appropriately.

---

# 7. Machine Interaction Contract

A package should never simply float through a machine.

Every major interaction should communicate:

```text
APPROACH
    ↓
ALIGN
    ↓
CAPTURE / ENGAGE
    ↓
PROCESS
    ↓
RELEASE
    ↓
RESUME
```

If a machine is processing the package, the package should physically stop or slow according to the machine metaphor.

If a machine is unavailable or the system state requires waiting, the package should visibly wait rather than teleporting through.

The machine should participate in the transformation.

---

# 8. Stage 1 — Gateway

## Software role

The Gateway receives an archive communication and produces the ingested representation.

The source describes the Gateway retrieving the communication in chunks, stripping the body/attachments into a smaller processing representation, and producing ingest/outbox state.

## Initial state

```text
RAW
```

The package should initially appear relatively complete/bulky.

It should visibly represent:

- communication identity
- archive reference
- original payload
- basic metadata

Do not invent unnecessary fields.

## Transformation

```text
RAW PACKAGE
    ↓
package enters Gateway
    ↓
machine captures package
    ↓
payload processing begins
    ↓
bulk/raw payload is progressively reduced
    ↓
processing metadata remains
    ↓
package is compacted/sealed
    ↓
INGESTED PACKAGE
```

The reduction must be animated.

Possible visual techniques:

- internal payload retracts
- unnecessary bulk folds inward
- payload layers are stripped
- remaining metadata core becomes more prominent
- package closes/seals

Do not simply scale the package down instantly.

## Result

```text
INGESTED
```

---

# 9. Stage 2 — Qualifier

## Software role

The Qualifier determines which surveillance pipelines claim the communication based on participant membership.

## Transformation

```text
INGESTED
    ↓
package enters comparator
    ↓
participant information is exposed
    ↓
comparison mechanism activates
    ↓
relevant population is consulted
    ↓
matching participants are identified
    ↓
pipeline qualification markers are generated
    ↓
markers physically attach to package
    ↓
comparator closes
    ↓
QUALIFIED
```

The package remains the same physical object.

Qualification markers should be physically added rather than appearing as text changes.

If multiple pipeline IDs are applicable, represent them as multiple physical markers/tags/plates attached to the package.

If no pipeline claims the communication, use a physical terminal/divert path.

Do not invent a business outcome beyond what the source establishes.

---

# 10. Stage 3 — Filter

## Software role

The Filter evaluates surveillance policies, including the documented ignore and flag policy paths.

## Transformation

```text
QUALIFIED
    ↓
package enters screening mechanism
    ↓
relevant policy information exposed
    ↓
ignore-policy screening
    ↓
result incorporated
    ↓
flag-policy screening
    ↓
result incorporated
    ↓
package exits screening
    ↓
EVALUATED
```

Use two visibly distinct processing mechanisms if the existing machine design supports them.

Do not make the package simply change colour.

The policy result should become part of the package's physical state.

If processing terminates, physically divert the package.

---

# 11. Stage 4 — Policy Evaluator

This is one of the most important transformations.

The Evaluator combines local evaluation with asynchronous Cognition processing.

The package must remain one object.

## Local path

```text
package
   ↓
local evaluation mechanism
   ↓
result generated
   ↓
result incorporated into package
```

## Cognition path

```text
package
   ↓
content representation extracted
   ↓
request dispatched externally
   ↓
package remains in waiting/holding state
   ↓
Cognition processes request
   ↓
verdict returns
   ↓
verdict incorporated into package
   ↓
package resumes
```

Do not represent Cognition as a normal next conveyor station.

The visual story must clearly communicate:

> The package has delegated part of its processing and is waiting for the result.

The temporary Cognition request is derived from the package.

Do not create a second independent communication package.

---

# 12. Stage 5 — Quota Manager

## Software role

The Quota Manager determines whether the surveilled communication is admitted into sampling.

The source also establishes atomic quota counters.

## Transformation

```text
SURVEILLED
    ↓
package enters admission mechanism
    ↓
counter/register activates
    ↓
admission decision occurs
    ↓
ADMITTED / NOT ADMITTED
```

If admitted:

```text
sampling marker physically engages
↓
SAMPLED
```

If not:

```text
physical diverter
↓
terminal/non-sampled path
```

Do not represent this as an arbitrary colour change.

The decision should visibly come from the machine mechanism.

---

# 13. Stage 6 — Alerting

## Software role

Alerting enriches the sampled communication and produces an alerted/supervised representation.

## Transformation

Use an assembly/enrichment metaphor.

```text
SAMPLED PACKAGE
        ↓
    enrichment begins
        ↓
┌───────┼────────┬────────┐
│       │        │        │
A       B        C        D
│       │        │        │
└───────┼────────┴────────┘
        ↓
components physically attach
        ↓
package closes/locks
        ↓
ALERTED PACKAGE
```

Do not make four data fields suddenly appear.

If the source supports fewer/more distinct enrichment operations, use the actual behaviour.

The important point is:

> Additional information becomes physically incorporated into the same package.

---

# 14. Stage 7 — Echo Engine

## Software role

The Echo Engine compares the communication against historical echo state using the documented fingerprint/history mechanism.

## Transformation

```text
ALERTED
    ↓
package enters history comparator
    ↓
fingerprint representation is extracted
    ↓
historical state is consulted
    ↓
comparison occurs
    ↓
echo/new determination returns
    ↓
result incorporated into package
    ↓
ECHO_EVALUATED
```

The history should be external state to the package.

Do not make the package physically travel backwards into historical data.

Represent the relationship as:

```text
PACKAGE
   │
   └── fingerprint ──► HISTORY
                         │
                         ▼
                    comparison
                         │
                         ▼
                    result
                         │
                         ▼
                      PACKAGE
```

---

# 15. Stage 8 — Indexer

## Software role

The Indexer consumes processed communications and materializes them for indexing.

The source describes batching/bulk processing.

## Transformation

```text
ECHO_EVALUATED
    ↓
package enters accumulation/batch mechanism
    ↓
package joins batch
    ↓
batch reaches processing condition
    ↓
indexable representation is created
    ↓
representation dispatched to indexing infrastructure
    ↓
INDEX_READY / INDEXED
```

Do not make the package disappear instantly into Elasticsearch.

Show the physical materialization.

If the existing simulation has batch counters, reuse them.

---

# 16. Terminal States

A terminal state must be represented physically.

Never:

- delete the package
- fade it instantly
- teleport it
- swap it for a terminal icon

Instead:

```text
machine
   ↓
decision
   ↓
diverter opens
   ↓
package follows terminal path
   ↓
package is deposited
   ↓
terminal state remains visible
```

The terminal representation should communicate why processing stopped where the source establishes that reason.

---

# 17. Audit Receipts

Audit events are derivative records.

They are NOT the same object as the communication package.

When a component emits an audit event:

```text
COMMUNICATION PACKAGE
          │
          └────► smaller AUDIT RECEIPT
```

The receipt can physically detach from the package and travel through the audit network.

Do not create a second full-size communication package.

The visual distinction should be obvious:

- communication package = primary object
- audit receipt = derivative record

The receipt may contain a visual reference to the package identity if useful.

---

# 18. Configuration

Configuration is not part of the communication package.

Do not attach configuration payloads to it.

Configuration should influence the machine/environment.

If the package carries a window token or processing context because the actual software does, represent that as a small persistent identity/context marker rather than making the entire configuration physically travel with it.

---

# 19. Package Transformation Rules

The package should progressively evolve.

Example:

```text
RAW
 └─ full payload

INGESTED
 └─ compact processing representation
    + ingestion state

QUALIFIED
 └─ ingested representation
    + pipeline qualification markers

EVALUATED
 └─ qualified representation
    + policy evaluation state

SURVEILLED
 └─ evaluated representation
    + surveillance verdict

SAMPLED
 └─ surveilled representation
    + sampling decision

ALERTED
 └─ sampled representation
    + enrichment/alert state

ECHO_EVALUATED
 └─ alerted representation
    + echo determination

INDEX_READY
 └─ final processing representation
    + indexing state
```

Do not replace the package between these states.

---

# 20. Animation Timing

Do not make every transformation the same duration.

Use duration based on the apparent complexity of the operation.

Suggested relative timing:

```text
simple state mutation       = short
comparison                  = medium
mechanical transformation   = medium/long
multi-stage enrichment      = long
Cognition round trip        = longest / asynchronous
batch accumulation          = variable
terminal diversion          = short but visible
```

The exact durations should be derived from the existing animation architecture.

Do not introduce arbitrary global timing if the project already has an animation system.

---

# 21. Reusable Implementation Architecture

Before implementing all stages, create a reusable transformation abstraction.

Conceptually:

```text
CommunicationPackage
        │
        ▼
PackageState
        │
        ▼
TransformationPlan
        │
        ├── prepare
        ├── engage
        ├── process
        ├── mutate
        ├── incorporate
        └── release
```

Each stage should define its own transformation plan rather than implementing unrelated animation logic.

Avoid duplicated:

- coordinate calculations
- orientation calculations
- interpolation
- package movement
- state transitions
- animation lifecycle handling

Reuse existing project utilities wherever possible.

---

# 22. Orientation and Geometry Implementation

Before implementing package transformations, inspect the existing code and identify:

- conveyor path representation
- path interpolation utilities
- machine anchor points
- machine entry/exit points
- world coordinate conventions
- camera configuration
- isometric orientation utilities
- animation/tween utilities

Use those existing abstractions.

Do not introduce a parallel coordinate system.

For curved paths:

```text
position(t) = path position
orientation(t) = path tangent orientation
```

For machine processing:

```text
approach orientation
→ machine intake orientation
→ processing orientation
→ machine exit orientation
→ downstream tangent
```

All should interpolate smoothly.

---

# 23. Implementation Sequence

Do not attempt the complete journey in one implementation step.

### Phase 1 — Inspect

Inspect the existing implementation.

Identify the current package/object, path system, machine anchors, animation system and rendering architecture.

Do not modify anything yet.

### Phase 2 — Package model

Implement the persistent package/state model.

Demonstrate:

```text
RAW → INGESTED
```

with a real transformation.

### Phase 3 — Orientation

Verify:

- conveyor alignment
- machine alignment
- curve following
- smooth rotation
- no camera-relative errors

### Phase 4 — Transformation framework

Generalize the transformation lifecycle.

### Phase 5 — Implement remaining stages

Implement:

```text
Qualifier
Filter
Evaluator/Cognition
Quota
Alerting
Echo
Indexer
```

one at a time.

### Phase 6 — Terminal paths

Implement physical terminal/diversion behaviour.

### Phase 7 — Audit receipts

Implement derivative audit receipts without duplicating the communication package.

### Phase 8 — Complete journey

Run the package through the entire system.

### Phase 9 — Polish

Fix:

- clipping
- floating
- orientation
- timing
- abrupt state changes
- visual ambiguity
- excessive effects

---

# 24. Verification Requirements

At every stage verify:

### Identity

Is this visibly the same package?

### State

Can the viewer see what changed?

### Transformation

Did the change happen progressively?

### Physicality

Does the machine appear to cause the change?

### Orientation

Is the package aligned with the conveyor and machine?

### Continuity

Does the package move naturally into the next stage?

### Semantics

Does the visual transformation correspond to actual software behaviour?

---

# 25. Do Not Do These Things

Do not:

- redesign existing machinery
- redesign the floor
- redesign the camera
- replace the existing isometric visual language
- create generic floating software icons
- use camera-facing package geometry
- snap package orientation
- replace the package mesh at every stage
- invent business rules
- invent package fields as factual system data
- turn audit receipts into duplicate communication packages
- turn Cognition into a normal conveyor station
- make configuration physically travel with the package
- use colour changes as the primary representation of state
- hide transformations behind machines
- teleport packages
- make terminal packages disappear
- add decorative complexity that does not explain behaviour

---

# 26. Acceptance Criteria

The implementation is complete only when all of the following are true:

1. One persistent communication package can be followed through the journey.
2. The package physically travels along the existing assembly line.
3. The package follows the conveyor's orientation.
4. Curved conveyor sections produce smooth position and rotation.
5. Machine interaction points are world-space aligned.
6. The package visibly enters and engages each relevant machine.
7. Each major software state produces a visible physical transformation.
8. No major transformation is an instantaneous object swap.
9. The transformation has a visible preparation, processing and completion phase.
10. Package geometry remains physically plausible.
11. Qualifier visibly adds qualification state.
12. Filter visibly performs screening/evaluation.
13. Evaluator visibly handles local evaluation and Cognition delegation.
14. Cognition is visibly asynchronous.
15. Quota visibly performs an admission/sampling decision.
16. Alerting visibly assembles/enriches the package.
17. Echo visibly performs historical comparison.
18. Indexer visibly performs accumulation/materialization.
19. Terminal states physically divert and remain visible.
20. Audit produces derivative receipts rather than duplicate packages.
21. Configuration does not incorrectly become package payload.
22. Existing machines and environment remain intact.
23. No second incompatible coordinate system is introduced.
24. No camera-relative physical transformations are introduced.
25. The complete journey remains understandable when viewed without reading implementation code.

---

# 27. Final Test

Run the complete animation without relying on labels.

Ask:

> Can I tell that this is the same communication package throughout the journey?

Then ask:

> Can I understand what each machine physically did to it?

Then:

> Can I see the transformation happening rather than merely seeing the result?

If any answer is no, fix the physical transformation rather than adding more labels.

The final experience should feel like:

```text
one physical communication package
        ↓
enters machine
        ↓
machine physically processes it
        ↓
package visibly changes
        ↓
package leaves
        ↓
next machine processes the evolved package
```

The system should feel like an industrial process in which software state has been translated into physical machinery and material transformation.
