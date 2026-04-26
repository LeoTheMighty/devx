# Focus-group prompt — reaction to a proposed change

Used during `/devx-plan` after party-mode team-lens critique is complete. One consultation session per epic.

## System role

You will role-play each persona in this project's focus group independently. Before responding as a persona, load that persona's full `persona-*.md` file and inhabit its voice — demographics, goals, frustrations, tech savvy, reactions library, red flags, delights.

Never generalize. A generic "users would like this" is a failure. Each persona's reaction must be identifiable as that persona.

## Input

1. The epic's end-user flow (as written in the draft epic file after party-mode).
2. The epic's frontend / backend / infrastructure change summaries.
3. Every persona file under `focus-group/personas/`.

## Flow

### Per-persona reactions (one section per persona, in `weight` descending order)

For each persona:

1. **Reaction** (2–4 sentences, in that persona's voice): gut reaction to the proposed change.
2. **Red flags hit** (from their signature list): comma-separated, or "none".
3. **Delights hit** (from their signature list): comma-separated, or "none".
4. **First-week usage likelihood** (0–10).
5. **Open question the persona would ask** (one sentence, optional — only if they'd actually ask it).

### Anti-persona check (the anti-persona gets a dedicated section)

1. Would this epic move us toward the anti-persona?
2. If yes, is there a version of the epic that serves the real personas without the drift?

### Synthesis (written by the focus-group agent, not any persona)

1. **Shared concerns** — which ≥2 personas raised the same objection? List each.
2. **Most-at-risk persona** — one name, one-sentence reason.
3. **Most-delighted persona** — one name, one-sentence reason.
4. **Weighted usage prediction** — sum of `(persona weight × first-week usage)` across the panel.
5. **One change to propose** — the single modification that would raise weighted usage the most.
6. **Questions to escalate** — if the synthesis surfaces a decision only the user can make, draft the `INTERVIEW.md` entry verbatim.

## Output destination

Write the full session to `focus-group/sessions/session-<YYYY-MM-DD>-<epic-slug>-reaction.md` with:

- `type: simulated-session`
- `trigger: planning`
- `subject: <epic-slug>`
- `personas_consulted: [...]`

Cross-reference the session from the epic file under a `## Focus-group reactions` heading. If synthesis produced INTERVIEW entries, append them to `INTERVIEW.md` before returning.

## Anti-patterns to avoid

- **Don't let personas agree with each other without meaningful pushback.** If two personas respond identically, one of them isn't doing their job.
- **Don't soften criticism.** A persona who finds the epic bad should say so, in their voice.
- **Don't predict numeric usage with more than 1 decimal place.** False precision is worse than honest range.
- **Don't invent new red flags or delights** not present in the persona's file. If the proposed change is adjacent to something new, flag it in synthesis as "no persona has a stance on X — propose adding to persona reaction libraries."
