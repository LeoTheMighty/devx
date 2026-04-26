# Focus-group prompt — pre-promotion panel review

Used before every `develop → main` promotion gate. The panel reviews the accumulated user-visible changes and either clears, objects, or blocks.

## System role

Role-play each persona. Input is the diff of user-visible surface between the last `main` commit and the current `develop` HEAD.

## Input

1. `git log --oneline origin/main..develop` — every commit about to ship.
2. Filtered to user-visible commits only (skip infra, tests, docs — unless those changed user behavior).
3. Relevant screenshots if any (pulled from the exploratory QA runs' output directory).
4. Every persona file.

## Flow

### Per-persona pre-ship review (weight-descending)

For each persona:

1. **If I opened the app today for the first time** — one paragraph: what would I notice? What would stand out?
2. **Red flags hit by this batch** — from signature list. "None" is a valid answer.
3. **Delights hit by this batch** — from signature list.
4. **Would I uninstall over anything here?** — yes/no + one sentence.
5. **Block or clear** — one of:
    - `clear` (no objection),
    - `object` (concerned but not blocking),
    - `block` (would uninstall).

### Weighted panel verdict

Compute:
- `block_weight = sum(persona.weight for persona if verdict == block)`
- `object_weight = sum(persona.weight for persona if verdict == object)`

Promotion gate rules:

- If `block_weight >= 0.40`: promotion blocked. Writes `MANUAL.md` entry with each blocking persona's objection. User can override explicitly.
- If `block_weight < 0.40` but `block_weight > 0` OR `object_weight >= 0.40`: promotion requires user approval (not auto-promoted even under trust-gradient autonomy). Writes `INTERVIEW.md` entry with panel summary.
- If `block_weight == 0` and `object_weight < 0.40`: clear. Promotion proceeds per trust-gradient rules.

### Anti-persona drift check

Does this batch of changes move the product toward the anti-persona's interests at the expense of real personas? If yes, log a `LESSONS.md` candidate proposing a course correction.

## Output

Write to `focus-group/sessions/session-<YYYY-MM-DD>-pre-promotion.md` with:

- `type: simulated-session`
- `trigger: pre-merge`
- `subject: promotion-<date>`
- `verdict: <clear|object|block>`
- `block_weight: <float>`
- `object_weight: <float>`

Link the session from the promotion PR description. If verdict is `object` or `block`, link from `INTERVIEW.md` / `MANUAL.md` too.

## Anti-patterns

- **Don't make the panel block everything.** A panel that blocks >50% of promotions is miscalibrated — either personas are too risk-averse or weights are wrong. LearnAgent should flag this.
- **Don't let the panel approve magic.** Every `clear` should be traceable to specific delights or the absence of flagged red flags. Bland approvals are failures.
- **Don't consult the panel on non-user-visible changes.** If the diff is infra / refactoring / test-only, skip the panel entirely.
