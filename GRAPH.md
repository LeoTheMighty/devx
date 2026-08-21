<!-- GENERATED FILE — do not hand-edit.
     Regenerate with `devx graph`; `devx graph --check` fails on drift.
     Source of truth is the backlog rows + spec frontmatter this renders. -->

# Story graph

199 specs across 23 groups — 12 blocked · 146 done · 6 in-progress · 35 ready; 397 edges.

## Legend

| Glyph | Meaning |
|---|---|
| `A --> B` | A is **blocked by** B — B must land first |
| `A -.-> B` | **lineage** — A spawned, or was superseded by, B |
| `A --- \|par\| B` | **parallel-safe** — A and B may run at once |
| subgraph | one workstream or epic; a fully-settled one collapses to a summary node |
| node fill | `ready` blue · `in-progress` amber · `blocked` red · `done` green · `deleted`/`superseded` grey |
| `(INTERVIEW Q＃n)` / `(MANUAL Mx)` | the item is gated on a human decision or action |

## Board

```mermaid
flowchart TD
  subgraph sg_execute_rehome_bmad_eject["execute-rehome-bmad-eject (workstream)"]
    bd5b5e["bd5b5e Execute Rehome Bmad Eject"]
  end
  subgraph sg_harness_fold_in["harness-fold-in (workstream)"]
    grp_harness_fold_in["harness-fold-in — 7/7 done, last merged 2026-07-26"]
  end
  subgraph sg_mid_story_split["mid-story-split (workstream)"]
    e0a67e["e0a67e Mid Story Split"]
    mss101["mss101 Split primitive (lib + CLI)"]
    mss102["mss102 Claim branch inheritance"]
    mss103["mss103 Loop split integration (INTERVIEW Q＃15)"]
    mss104["mss104 Handoff Snippet retirement sweep"]
    mssret["mssret Retro + LEARN.md updates (interim retro d…"]
  end
  subgraph sg_multi_loop_concurrency["multi-loop-concurrency (workstream)"]
    grp_multi_loop_concurrency["multi-loop-concurrency — 9/9 done, last merged 2026-08-21"]
  end
  subgraph sg_portability_install["portability-install (workstream)"]
    b3f7a1["b3f7a1 Vision-gap Track 1 — Portability & instal…"]
    pin101["pin101 Packaged skills mirror + drift guard (ski…"]
    pin102["pin102 Skills installer library (init-skills.ts…"]
    pin103["pin103 Bare `devx init` non-interactive scaffold…"]
    pin104["pin104 install:global + SHA provenance + docs-to…"]
    pin105["pin105 S-5 validation — timed scratch scenario +…"]
    pinret["pinret Retro + LEARN.md updates (interim retro d…"]
  end
  subgraph sg_retro_listener["retro-listener (workstream)"]
    343b43["343b43 `devx learnings workstream` — harvest the…"]
    620c74["620c74 Retro Listener"]
    9946f9["9946f9 Human smoke of the devx learn-watch Termi…"]
    e2da94["e2da94 `/devx-plan` design+plan stage: verify co…"]
    rtl101["rtl101 Listener — nudge pattern, queue store, `l…"]
    rtl102["rtl102 `learn:` config section (idle window, ret…"]
    rtl103["rtl103 Watcher core — readiness, allowlist, outc…"]
    rtl104["rtl104 Watcher CLI — spawn arms, drain loop, `de…"]
    rtl105["rtl105 Hook registration template + `/devx-init`…"]
    rtl106["rtl106 `/devx-learn` outlet routing rework (orde…"]
    rtlret["rtlret Retro + LEARN.md updates (interim retro d…"]
  end
  subgraph sg_story_graph["story-graph (workstream)"]
    grp_story_graph["story-graph — 9/9 done, last merged 2026-08-06"]
  end
  subgraph sg_usage_window_governor["usage-window-governor (workstream)"]
    c8e2d4["c8e2d4 Vision-gap Track 2 — Usage-window governo…"]
  end
  subgraph sg_bidirectional_writes_offline["bidirectional-writes-offline (epic)"]
    c30001["c30001 Offline queue foundation (drift + connect…"]
    c30002["c30002 Git Data API client (atomic multi-file co…"]
    c30003["c30003 Add tab — (+) button flow (atomic spec +…"]
    c30004["c30004 Inline INTERVIEW answering (Contents API…"]
    c30005["c30005 Conflict resolution UI (3-way view for ex…"]
    c30ret["c30ret Retrospective + LEARN.md updates for epic…"]
  end
  subgraph sg_bmad_audit["bmad-audit (epic)"]
    grp_bmad_audit["bmad-audit — 4/4 done"]
  end
  subgraph sg_devx_cli_skeleton["devx-cli-skeleton (epic)"]
    grp_devx_cli_skeleton["devx-cli-skeleton — 6/6 done, last merged 2026-04-26"]
  end
  subgraph sg_devx_config_yaml_schema_cli["devx-config-yaml-schema-cli (epic)"]
    grp_devx_config_yaml_schema_cli["devx-config-yaml-schema-cli — 5/5 done, last merged 2026-04-26"]
  end
  subgraph sg_devx_init_skill["devx-init-skill (epic)"]
    grp_devx_init_skill["devx-init-skill — 9/9 done, last merged 2026-04-27"]
  end
  subgraph sg_devx_manage_v0["devx-manage-v0 (epic)"]
    grp_devx_manage_v0["devx-manage-v0 — 7/7 done, last merged 2026-05-07"]
  end
  subgraph sg_devx_plan_skill["devx-plan-skill (epic)"]
    grp_devx_plan_skill["devx-plan-skill — 7/7 done, last merged 2026-05-05"]
  end
  subgraph sg_devx_skill["devx-skill (epic)"]
    grp_devx_skill["devx-skill — 8/8 done, last merged 2026-05-07"]
  end
  subgraph sg_flutter_scaffold_ios_on_device["flutter-scaffold-ios-on-device (epic)"]
    a10001["a10001 Flutter project scaffold + nav shell"]
    a10002["a10002 Riverpod + Material 3 theme + go_router f…"]
    a10003["a10003 iOS project configuration (bundle ID, sig… (MANUAL M1.1)"]
    a10004["a10004 First on-device run (plugged-in iPhone) (MANUAL M1.2)"]
    a10005["a10005 TestFlight pipeline (archive + upload + i… (MANUAL M1.3)"]
    a10ret["a10ret Retrospective + LEARN.md updates for epic…"]
  end
  subgraph sg_github_connection_read["github-connection-read (epic)"]
    b20001["b20001 Auth service + PAT onboarding screen"]
    b20002["b20002 GitHub client wrapper + Contents read cli…"]
    b20003["b20003 Backlog markdown → structured model parser"]
    b20004["b20004 Inbox tab — INTERVIEW + MANUAL + open PRs"]
    b20005["b20005 Backlogs tab + spec detail view"]
    b20ret["b20ret Retrospective + LEARN.md updates for epic…"]
  end
  subgraph sg_mode_derived_merge_gate["mode-derived-merge-gate (epic)"]
    grp_mode_derived_merge_gate["mode-derived-merge-gate — 4/4 done, last merged 2026-04-28"]
  end
  subgraph sg_os_supervisor_scaffold["os-supervisor-scaffold (epic)"]
    grp_os_supervisor_scaffold["os-supervisor-scaffold — 6/6 done, last merged 2026-04-27"]
  end
  subgraph sg_pr_template["pr-template (epic)"]
    grp_pr_template["pr-template — 3/3 done, last merged 2026-05-02"]
  end
  subgraph sg_real_time_updates["real-time-updates (epic)"]
    d40001["d40001 Cloudflare Worker scaffold + GitHub webho…"]
    d40002["d40002 FCM sender + service-account JWT auth (MANUAL M4.1, MANUAL M4.2)"]
    d40003["d40003 Event filters + fanout to device tokens (MANUAL M4.4)"]
    d40004["d40004 Device registration + deregistration endp…"]
    d40005["d40005 Flutter firebase_messaging integration +… (MANUAL M4.3)"]
    d40006["d40006 Deep-linking + iOS inline-reply notificat…"]
    d40007["d40007 Laptop-side fast-path webhook receiver (o…"]
    d40ret["d40ret Retrospective + LEARN.md updates for epic…"]
  end
  subgraph sg_standalone["standalone — no workstream or epic"]
    28b267["28b267 learn.auto_allow — the retro watcher stop…"]
    2e7b45["2e7b45 QA walkthrough for 'Backfill — adds-only…"]
    357d0c["357d0c Loop instance registry: crash-orphan-thro…"]
    3b9e07["3b9e07 `devx loop` never emits the mandatory `ph…"]
    494590["494590 Loop token accounting implausibly low — b…"]
    4d1a9c["4d1a9c claim commits on whatever branch the main…"]
    4d9c1a["4d9c1a QA walkthrough — sgr104 regen hooks (clai…"]
    5c8b21["5c8b21 loop-concurrency G-1 test sits ~1.3x unde…"]
    5e1a77["5e1a77 16 tests run past their own timeout and s…"]
    67a7e8["67a7e8 QA walkthrough — claim branch-posture gua…"]
    6a913f["6a913f hash→spec resolution hardcodes dev/ acros…"]
    74632d["74632d loop-driver fixture teardown races on mac…"]
    7a2d1f["7a2d1f Mobile companion v0.1 through real-time s…"]
    7b3e2a["7b3e2a merge-gate reads YAML `branch: null` as t…"]
    7c1e93["7c1e93 loop-concurrency G-1 harness times out un…"]
    7e2b56["7e2b56 emit-retro-story writes its artifacts to…"]
    8a9586["8a9586 Loop merge tail leaves GRAPH.md stale — F…"]
    8b9165["8b9165 QA walkthrough — sgr105 mark-done helper…"]
    97f6d8["97f6d8 QA walkthrough — devx graph renderer + CL…"]
    9b9be5["9b9be5 devx gate evals lacks mid-flight state-aw…"]
    9c4e21["9c4e21 appendManualEntry read-check-write race c…"]
    9f24c7["9f24c7 Unparseable spec frontmatter reads as an…"]
    a01000["a01000 Phase 0 — Foundation: /devx-init + config…"]
    a02000["a02000 Phase 6 — Focus group: persistent persona…"]
    a03000["a03000 Cross-cutting — realtime stream + Live Ac…"]
    a7c3f9["a7c3f9 Backlog-lock timeouts count toward the sy…"]
    b01000["b01000 Phase 1 — Single-agent core loop: /devx-p…"]
    b02000["b02000 Phase 7 — Exploratory QA: browser-use sub…"]
    b365ac["b365ac yaml in devDependencies but imported at r…"]
    b41f7c["b41f7c Loop discardWorktree force-deletes an inh…"]
    b7f2c1["b7f2c1 Unidentified 1-in-2,665 suite flake under…"]
    c808b1["c808b1 /devx-learn unattended mode — route and a…"]
    c81f04["c81f04 backlog-mutate R3 concurrency test is fla…"]
    c94f14["c94f14 await-remote-ci reads a CONFLICTING PR as…"]
    c98aee["c98aee Wire flutter analyze + test into devx-ci…"]
    cf65aa["cf65aa loop merge tail never emits the dvx103 ph…"]
    d01000["d01000 Phase 3 — Parallelism & coordination: loc…"]
    d02000["d02000 Phase 9 — Modes & full gate cascade"]
    d7e8e5["d7e8e5 Merge-tail helpers treat transient gh Gra…"]
    db36af["db36af devx doctor — mechanical state reconcilia…"]
    dc7514["dc7514 Loop counts infra hangs as item failures…"]
    e01000["e01000 Phase 4 — Observability surfaces: TUI, we…"]
    e02000["e02000 Phase 10 — Polish + dogfood"]
    e3f1c2["e3f1c2 install:global produces non-executable de…"]
    e5a9c0["e5a9c0 Vision-gap Track 3 — Interim blocker push…"]
    ea4f41["ea4f41 QA-walkthrough naming `test/test-story-ha…"]
    eac611["eac611 Integration: manage tick writes state in…"]
    ebf8c4["ebf8c4 QA walkthrough — learn.auto_allow unatten…"]
    ecdcda["ecdcda manage-spawn / manage-spawn-integration t…"]
    f01000["f01000 Phase 5 — Test, debug, retro, learn"]
    f02000["f02000 Cross-cutting — thoroughness axis wiring"]
    f1d6b2["f1d6b2 Vision-gap Track 4 — Fleet layer: thin mu…"]
    lpf101["lpf101 Loop preflight main-health check"]
    roc101["roc101 /devx Phase 1 resume-detection — verify c…"]
    tur101["tur101 Retire the review tour — rip out `devx to…"]
    v2d101["v2d101 V2.4 — universal /devx dispatcher + debug…"]
    v2e101["v2e101 V2.1-A — engine CLI primitives (workstrea…"]
    v2e102["v2e102 V2.1-B — stage skill bodies (prd / design…"]
    v2l101["v2l101 V2.5 — overnight loop (gnhf fold-in)"]
    v2o101["v2o101 V2.6 — outcome loop + migration retro"]
    v2s101["v2s101 V2.0-b/c — engine template scaffold + bac…"]
    v2t101["v2t101 V2.3 — static HTML review tour on every PR"]
    v2x101["v2x101 V2.2 — execute re-home + BMAD ejection"]
  end
  28b267 -.-> ebf8c4
  28b267 -.-> ecdcda
  4d1a9c -.-> 67a7e8
  4d1a9c -.-> 7b3e2a
  5c8b21 -.-> 5e1a77
  620c74 -.-> rtl101
  620c74 -.-> rtl102
  620c74 -.-> rtl103
  620c74 -.-> rtl104
  620c74 -.-> rtl105
  620c74 -.-> rtl106
  620c74 -.-> rtlret
  7a2d1f -.-> a10ret
  7a2d1f -.-> b20ret
  7a2d1f -.-> c30ret
  7a2d1f -.-> d40ret
  9946f9 --> rtl104
  9c4e21 -.-> 6a913f
  a01000 -.-> grp_bmad_audit
  a01000 -.-> grp_devx_config_yaml_schema_cli
  a01000 -.-> grp_devx_cli_skeleton
  a01000 -.-> grp_devx_init_skill
  a01000 -.-> grp_os_supervisor_scaffold
  a02000 --> f01000
  a03000 --> 7a2d1f
  a10001 -.-> c98aee
  a10002 --> a10001
  a10003 --> a10001
  a10004 --> a10002
  a10004 --> a10003
  a10005 --> a10004
  a10ret --> a10001
  a10ret --> a10002
  a10ret --> a10003
  a10ret --> a10004
  a10ret --> a10005
  b01000 --> a01000
  b01000 -.-> grp_devx_skill
  b01000 -.-> grp_devx_manage_v0
  b01000 -.-> grp_mode_derived_merge_gate
  b01000 -.-> grp_devx_plan_skill
  b01000 -.-> grp_pr_template
  b02000 --> a02000
  b02000 --> e01000
  b20001 --> a10005
  b20002 --> b20001
  b20003 --> b20002
  b20004 --> b20003
  b20005 --> b20003
  b20ret --> b20001
  b20ret --> b20002
  b20ret --> b20003
  b20ret --> b20004
  b20ret --> b20005
  b3f7a1 -.-> pin101
  b3f7a1 -.-> pin102
  b3f7a1 -.-> pin103
  b3f7a1 -.-> pin104
  b3f7a1 -.-> pin105
  b3f7a1 -.-> pinret
  b41f7c --> mss103
  c30001 --> b20005
  c30002 --> b20002
  c30003 --> c30001
  c30003 --> c30002
  c30004 --> b20004
  c30004 --> c30001
  c30005 --> c30003
  c30005 --> c30004
  c30ret --> c30001
  c30ret --> c30002
  c30ret --> c30003
  c30ret --> c30004
  c30ret --> c30005
  c808b1 --> 28b267
  grp_devx_config_yaml_schema_cli --> grp_devx_cli_skeleton
  grp_devx_cli_skeleton --> grp_devx_config_yaml_schema_cli
  d01000 -.-> grp_multi_loop_concurrency
  d02000 --> b02000
  d40001 --> c30005
  d40002 --> d40001
  d40003 --> d40002
  d40004 --> d40001
  d40005 --> d40004
  d40006 --> d40005
  d40007 --> d40003
  d40ret --> d40001
  d40ret --> d40002
  d40ret --> d40003
  d40ret --> d40004
  d40ret --> d40005
  d40ret --> d40006
  d40ret --> d40007
  db36af --> dc7514
  dc7514 -.-> db36af
  grp_devx_skill --> grp_mode_derived_merge_gate
  grp_devx_skill --> grp_pr_template
  grp_devx_skill -.-> roc101
  e01000 --- |par| f01000
  e02000 --> d02000
  e0a67e -.-> mss101
  e0a67e -.-> mss102
  e0a67e -.-> mss103
  e0a67e -.-> mss104
  e0a67e -.-> mssret
  e3f1c2 -.-> b365ac
  f02000 --> a01000
  f1d6b2 --> b3f7a1
  f1d6b2 --> c8e2d4
  grp_harness_fold_in -.-> cf65aa
  grp_harness_fold_in -.-> 494590
  grp_harness_fold_in -.-> lpf101
  grp_devx_init_skill --> grp_bmad_audit
  grp_devx_init_skill --> grp_devx_cli_skeleton
  grp_devx_init_skill --> grp_devx_config_yaml_schema_cli
  grp_devx_init_skill --> grp_os_supervisor_scaffold
  grp_devx_manage_v0 --> grp_devx_skill
  grp_multi_loop_concurrency -.-> eac611
  grp_multi_loop_concurrency -.-> a7c3f9
  grp_multi_loop_concurrency -.-> 357d0c
  grp_multi_loop_concurrency -.-> 74632d
  grp_multi_loop_concurrency -.-> b7f2c1
  mss102 -.-> b41f7c
  mss102 --> mss101
  mss102 --- |par| mss103
  mss103 -.-> c81f04
  mss103 --> mss101
  mss104 --> mss102
  mss104 --> mss103
  mssret -.-> e2da94
  mssret --> mss101
  mssret --> mss102
  mssret --> mss103
  mssret --> mss104
  pin102 -.-> 9c4e21
  pin102 --> pin101
  pin102 --- |par| pin104
  pin103 --> pin102
  pin103 --- |par| pin104
  pin104 --> pin101
  pin105 --> pin103
  pin105 --> pin104
  pinret --> pin101
  pinret --> pin102
  pinret --> pin103
  pinret --> pin104
  pinret --> pin105
  roc101 --> grp_devx_skill
  rtl101 --- |par| rtl102
  rtl101 --- |par| rtl106
  rtl103 --> rtl101
  rtl103 --- |par| rtl105
  rtl104 -.-> 9946f9
  rtl104 --> rtl102
  rtl104 --> rtl103
  rtl104 --- |par| rtl105
  rtl105 --> rtl101
  rtl105 --- |par| rtl106
  rtlret -.-> 343b43
  rtlret --> rtl101
  rtlret --> rtl102
  rtlret --> rtl103
  rtlret --> rtl104
  rtlret --> rtl105
  rtlret --> rtl106
  grp_story_graph -.-> 3b9e07
  grp_story_graph -.-> 97f6d8
  grp_story_graph -.-> ea4f41
  grp_story_graph -.-> 4d9c1a
  grp_story_graph -.-> 5c8b21
  grp_story_graph -.-> 7e2b56
  grp_story_graph -.-> 8a9586
  grp_story_graph -.-> 8b9165
  grp_story_graph -.-> c94f14
  grp_story_graph -.-> 9f24c7
  grp_story_graph -.-> d7e8e5
  grp_os_supervisor_scaffold --> grp_devx_cli_skeleton
  tur101 -.-> 7c1e93
  v2d101 --> v2x101
  v2e101 --> v2s101
  v2e102 --> v2e101
  v2l101 --> roc101
  v2l101 --> v2d101
  v2o101 --> v2l101
  v2t101 --> v2x101
  v2x101 --> grp_devx_manage_v0
  v2x101 --> v2e102
  classDef ready fill:#eef,stroke:#39f,color:#036
  classDef wip fill:#fe9,stroke:#e90,color:#740
  classDef blocked fill:#fee,stroke:#e44,color:#811
  classDef done fill:#efe,stroke:#2c5,color:#152
  classDef dropped fill:#eee,stroke:#aaa,color:#444
  classDef unknownStatus fill:#fff,stroke:#777,color:#222
  classDef collapsed fill:#eee,stroke:#777,color:#222
  class bd5b5e wip
  class grp_harness_fold_in collapsed
  class e0a67e wip
  class mss101 done
  class mss102 done
  class mss103 done
  class mss104 done
  class mssret done
  class grp_multi_loop_concurrency collapsed
  class b3f7a1 done
  class pin101 done
  class pin102 done
  class pin103 done
  class pin104 done
  class pin105 blocked
  class pinret wip
  class 343b43 ready
  class 620c74 wip
  class 9946f9 ready
  class e2da94 ready
  class rtl101 done
  class rtl102 done
  class rtl103 done
  class rtl104 done
  class rtl105 done
  class rtl106 done
  class rtlret wip
  class grp_story_graph collapsed
  class c8e2d4 ready
  class c30001 ready
  class c30002 ready
  class c30003 ready
  class c30004 ready
  class c30005 ready
  class c30ret ready
  class grp_bmad_audit collapsed
  class grp_devx_cli_skeleton collapsed
  class grp_devx_config_yaml_schema_cli collapsed
  class grp_devx_init_skill collapsed
  class grp_devx_manage_v0 collapsed
  class grp_devx_plan_skill collapsed
  class grp_devx_skill collapsed
  class a10001 done
  class a10002 done
  class a10003 blocked
  class a10004 ready
  class a10005 ready
  class a10ret ready
  class b20001 ready
  class b20002 ready
  class b20003 ready
  class b20004 ready
  class b20005 ready
  class b20ret ready
  class grp_mode_derived_merge_gate collapsed
  class grp_os_supervisor_scaffold collapsed
  class grp_pr_template collapsed
  class d40001 ready
  class d40002 ready
  class d40003 ready
  class d40004 ready
  class d40005 ready
  class d40006 ready
  class d40007 ready
  class d40ret ready
  class 28b267 done
  class 2e7b45 ready
  class 357d0c done
  class 3b9e07 done
  class 494590 done
  class 4d1a9c done
  class 4d9c1a ready
  class 5c8b21 done
  class 5e1a77 done
  class 67a7e8 ready
  class 6a913f done
  class 74632d done
  class 7a2d1f wip
  class 7b3e2a done
  class 7c1e93 done
  class 7e2b56 done
  class 8a9586 done
  class 8b9165 ready
  class 97f6d8 ready
  class 9b9be5 done
  class 9c4e21 done
  class 9f24c7 done
  class a01000 done
  class a02000 blocked
  class a03000 blocked
  class a7c3f9 done
  class b01000 done
  class b02000 blocked
  class b365ac done
  class b41f7c done
  class b7f2c1 done
  class c808b1 done
  class c81f04 done
  class c94f14 done
  class c98aee ready
  class cf65aa done
  class d01000 blocked
  class d02000 blocked
  class d7e8e5 done
  class db36af done
  class dc7514 done
  class e01000 blocked
  class e02000 blocked
  class e3f1c2 done
  class e5a9c0 ready
  class ea4f41 done
  class eac611 done
  class ebf8c4 ready
  class ecdcda done
  class f01000 blocked
  class f02000 blocked
  class f1d6b2 blocked
  class lpf101 done
  class roc101 done
  class tur101 done
  class v2d101 done
  class v2e101 done
  class v2e102 done
  class v2l101 done
  class v2o101 done
  class v2s101 done
  class v2t101 done
  class v2x101 done
```

## Warnings

4 warnings — reported, never auto-fixed.

- `heading-fallback` — DEV.md: epic heading 'bidirectional-writes-offline' names no plan hash — grouped by slug alone; add `(plan: <hash>)` or `(workstream <hash>)` to link it to its plan spec
- `heading-fallback` — DEV.md: epic heading 'flutter-scaffold-ios-on-device' names no plan hash — grouped by slug alone; add `(plan: <hash>)` or `(workstream <hash>)` to link it to its plan spec
- `heading-fallback` — DEV.md: epic heading 'github-connection-read' names no plan hash — grouped by slug alone; add `(plan: <hash>)` or `(workstream <hash>)` to link it to its plan spec
- `heading-fallback` — DEV.md: epic heading 'real-time-updates' names no plan hash — grouped by slug alone; add `(plan: <hash>)` or `(workstream <hash>)` to link it to its plan spec
