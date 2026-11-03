# Project Constitution

> This document defines the non-negotiable principles and governance rules for **tabit**.
> All agents and workflows must respect these principles.

## Project Overview

- **Name**: tabit
- **Type**: brownfield
- **Track**: solo

## Technical Stack

| **Language** | Python |

| **Auth** | JWT |

| **Stack** | FastAPI |

| **ORM** | SQLAlchemy |

| **Database** | PostgreSQL |

## Architecture: Domain-Driven Design

### Core Principles
- Domain logic is the heart of the application
- Entities have identity and lifecycle
- Value objects are immutable and compared by value
- Aggregates enforce consistency boundaries
- Repositories abstract persistence
- Domain events capture things that happened
- Ubiquitous language shared between code and stakeholders

### Layer Responsibilities

**Domain**: Core business logic
- Contains: entities, value-objects, domain-services, domain-events
- No dependencies on other layers
- Pure business logic
- Entities encapsulate rules
- Value objects immutable

**Application**: Use cases and orchestration
- Contains: use-cases, ports, dtos, application-services
- Only depends on Domain
- Use case implementations
- Port interfaces defined
- No direct infrastructure

**Infrastructure**: External concerns
- Contains: repositories, external-services, mappers, adapters
- Implements port interfaces
- Database repositories
- External API integrations
- Framework-specific code

**Presentation**: User interface
- Contains: controllers, views, presenters, api-routes
- Depends on Application layer
- HTTP request/response handling
- DTO/domain mapping
- External input validation

## Quality Standards

- **Unit Tests**: Required for all business logic
- **Framework**: pytest
- **Command**: `pytest`

- **Linting**: Ruff (`ruff check .`)

- **Formatting**: Ruff (`ruff format --check .`)

## Anti-Patterns to AVOID

- **Anemic Domain Model**: Entities with only getters/setters, no behavior
  - Fix: Add business logic methods to entities

- **Domain Layer Database Dependency**: Domain entities importing ORM decorators or database types
  - Fix: Keep domain entities pure, use mappers in infrastructure

- **Leaking Domain Logic**: Business rules implemented in controllers or services outside domain
  - Fix: Move business rules into domain entities or domain services

## Quality Principles

### Updated Standard Title

All tests must pass before merging.

### Code Quality

- Write self-documenting code with clear naming
- Keep functions focused and small (single responsibility)
- Prefer composition over inheritance
- Avoid premature optimization
- Delete dead code rather than commenting it out

### Testing

- Write tests for all new functionality
- Test behavior, not implementation details
- Maintain meaningful test coverage
- Use descriptive test names that explain the expected behavior
- Keep tests independent and isolated

### Error Handling

- Handle errors at appropriate boundaries
- Provide meaningful error messages to users
- Log errors with sufficient context for debugging
- Use structured error types (not generic Error)
- Never swallow errors silently

## Security Principles

### Security

- Never commit secrets, API keys, or credentials to source control
- Validate all inputs at system boundaries (user input, external APIs)
- Use parameterized queries to prevent SQL injection
- Apply principle of least privilege for all access controls
- Sanitize output to prevent XSS attacks

## Governance Principles

### Governance

- All architecture decisions require team review
- Breaking changes require ADR documentation
- Security issues take priority over feature work
- Code review required before merging to main
- Document non-obvious design decisions
- This constitution is **immutable** during the project lifecycle
- All architectural decisions must reference this document
- Exceptions require explicit documentation and approval

## Design Principles

### Design

## Before any UI work

Load, in order: `.claude/rules/design-constitution.md` →
`design/glossary/{context}.yaml` (the seam ledger for the touched context) →
the flow slice in `design/flows/` (if the task implements a flow) →
the project component registry. UI code written without these loaded fails review.

## Design triggers

A task trips a design redirect if it introduces or changes any of:

1. a user-facing noun not in the seam ledger, or a new meaning for an existing one
2. a new object type users see, or a new relationship between visible objects
3. a new user-initiated action (CTA) on any object
4. a destructive or irreversible operation
5. a new screen, surface type, or navigation entry
6. a multi-step flow, or a change to an existing flow's steps
7. a new empty/error/loading state class

NOT triggers (proceed without redirect): copy edits using ledger terms, layout
fixes inside an existing screen, styling changes inside the token vocabulary.

## Redirect protocol

On any trigger, check `design/coverage.yaml` for the touched context.
On a gap (missing/stale artifact): suggest ONCE per context+artifact per task —
"This task introduces {trigger}. Coverage for {context}.{artifact} is {state}.
Run /waypoint.design-model (or .flow) first, or proceed and the gap is enforced
at review." Proceeding writes a dated entry to `design/debt.yaml` and, for new
nouns, mints them `provisional` in the ledger. Review hard-fails on open debt,
missing/stale coverage, and nouns rejected at ratification; provisionals pass
until the next design.model run in their context, which must adjudicate them.

**Brownfield variant.** With no coverage AND a
`design/survey/env-contract.yaml` present, the redirect names the audit:
"This context ships screens the design record does not cover. Run
/waypoint.design-audit {context} to measure them, or proceed and the gap is
enforced at review." Measuring beats modelling from memory — guessing once
produced two approved mockups with the wrong page shape.

## Canonical verbs

Create (new object) · Add (attach existing) · Edit (mutate — Change/Modify/Update
banned as labels) · Save / Cancel (commit/abandon a form) · Delete (destroy —
permanent) · Remove (detach — recoverable) · View (navigate to detail — Show/
Display banned) · Duplicate · Archive / Restore · Search / Filter / Sort ·
Reorder (change sibling order — Move up/Move down banned as labels) ·
Export / Import (data-shape conversion out of/into the system) ·
Publish (make available at a stable URL, additive — corrections publish anew;
Upload banned as a label) · Download (retrieve a copy of a stored file — never
Export, which is data extraction) · Invite (people) · Assign / Unassign ·
Enroll (bind self to a track/plan) · Start (begin a session) ·
Write off (abandon a small owed amount as not collectible — gates are
policy, never confirm dialogs) · Approve / Reject (grant/refuse a GATED
action — Reject is not Cancel, which abandons your own form) ·
Enable / Disable ·
Close (dismiss, preserving state — never interchangeable with Cancel).
Button labels: canonical verb + ledger noun, 1–3 words, no articles, sentence
case. A label whose verb is not in this set fails review.

