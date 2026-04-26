---
name: Morgan
archetype: Enterprise engineering lead (anti-persona)
weight: 0.05
created: 2026-04-23
revised: 2026-04-23
source: seeded-at-init
kind: anti-persona
---

## Demographics
- Team of 15 engineers, dedicated PM, dedicated QA, dedicated SRE.
- Works in a 5000-person org.
- Operates under compliance regimes (SOC 2, ISO 27001).

## Why Morgan is here
Morgan is the explicit **anti-persona**. devx is NOT for Morgan's team. This file exists so that when a proposal starts looking like a feature Morgan would ask for, we surface the drift.

## Requests that signal scope drift toward Morgan
- Multi-tenant authentication
- Role-based access control
- SSO integration
- Hosted SaaS tier
- Audit log dashboards compliant with SOC 2 language
- Per-seat pricing tiers
- A "customer success" support surface
- Approval workflows involving 3+ people
- Branded enterprise reporting

## How to use this persona
When any proposal to add to devx starts resembling the list above:

1. Note it in the planning session.
2. Ask: "would Morgan find this valuable?"
3. If yes, ask: "would any of our real personas (Leonid / Dana / Sam / Jess) find this valuable?"
4. If only Morgan — cut it.
5. If Morgan + a real persona — check whether the feature can be implemented in a way that serves the real persona without adding Morgan-shaped surface.

## The anti-persona's useful signal
Morgan isn't wrong. His asks are sensible *in his context*. The discipline is that his context isn't our context, and serving both inflates scope and degrades the primary experience. The anti-persona keeps us honest about who we're for.

## Open invariants Morgan would violate (and we won't)
- "No hosted SaaS we operate."
- "No per-seat pricing."
- "No proprietary formats."
- "GitHub is your datastore; not a multi-tenant DB we manage."
