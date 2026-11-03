# Project Constitution: tabit

> This is your project's constitution — customize it to match your team's principles.
> WayPoint will not overwrite this file after initial creation.

## Project Overview

- **Name**: tabit
- **Type**: brownfield
- **Track**: solo

## Architecture: Domain-Driven Design

### Principles

- Domain logic is the heart of the application
- Entities have identity and lifecycle
- Value objects are immutable and compared by value
- Aggregates enforce consistency boundaries
- Repositories abstract persistence
- Domain events capture things that happened
- Ubiquitous language shared between code and stakeholders

### Layer Responsibilities

**Domain**: Core business logic
- No dependencies on other layers
- Pure business logic
- Entities encapsulate rules
- Value objects immutable

**Application**: Use cases and orchestration
- Only depends on Domain
- Use case implementations
- Port interfaces defined
- No direct infrastructure

**Infrastructure**: External concerns
- Implements port interfaces
- Database repositories
- External API integrations
- Framework-specific code

**Presentation**: User interface
- Depends on Application layer
- HTTP request/response handling
- DTO/domain mapping
- External input validation

### Anti-Patterns to Avoid

- **Anemic Domain Model**: Entities with only getters/setters, no behavior
- **Domain Layer Database Dependency**: Domain entities importing ORM decorators or database types
- **Leaking Domain Logic**: Business rules implemented in controllers or services outside domain

## Quality Standards

- Write tests for all new functionality
- Keep functions focused and small
- Prefer composition over inheritance
- Delete dead code rather than commenting it out

## Security Principles

1. **No secrets in code** — Use environment variables
2. **Validate all inputs** — At system boundaries
3. **Parameterized queries only** — Never concatenate SQL
4. **Principle of least privilege** — Minimal permissions

## Governance

- All architecture decisions require documentation
- Breaking changes require team review
- Exceptions require explicit approval
