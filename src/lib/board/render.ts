// `devx board`'s HTML — one index, one page per workstream (D1).
//
// Static and almost entirely no-JS. The one exception is mermaid, loaded from
// a CDN and ONLY on a page that actually has a graph; the alternative was
// build-time SVG via `mermaid-cli`, which needs a headless-Chromium download
// to render a diagram the repo already stores as text. A page with no graph
// gets no script tag at all, so the no-JS property holds for every page that
// does not need it.
//
// Styling is inline, dark-mode-aware through `prefers-color-scheme`, and
// about forty lines. A board that needed a build step would not get rebuilt.
//
// Pure: strings in, strings out. The IO lives in src/commands/board.ts.

import type { BoardModel, BoardWorkstream } from "./model.js";

/** HTML-escape. Every interpolated value goes through it — a workstream slug
 *  and a questions.md recommendation are both user-authored text, and a `<`
 *  in a recommendation would silently eat the rest of the page. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A workstream's page filename. Slug-derived, with every character that is
 *  not obviously safe in a filename or a URL collapsed — a slug comes from a
 *  directory name, and `..` or a slash in one must not escape the out dir. */
export function pageName(slug: string): string {
  const safe = slug.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return `${safe === "" ? "workstream" : safe}.html`;
}

/**
 * Page name per workstream, with collisions broken by a numeric suffix.
 *
 * `pageName` is LOSSY — it has to be, since a slug is a directory name and a
 * `/` or `..` in one must not escape the out dir — so two workstreams can
 * collapse onto one filename. Without this the second page overwrites the
 * first and BOTH index cards link to the survivor: a board that silently
 * shows one workstream's state under another's name, which is worse than
 * showing nothing. Reachable two ways: a hand-made directory carrying a
 * character `SLUG_RE` forbids, and two plan specs pointing at the same
 * workstream dir (the ambiguity `layout-tree-mismatch` already names).
 *
 * Same trick, and the same reason, as `assignGroupIds` in the graph renderer.
 * Keyed by INDEX rather than by slug, because two colliding entries may share
 * a slug outright and a slug-keyed map would hand them the same answer again.
 */
export function pageNames(slugs: readonly string[]): string[] {
  const used = new Set<string>();
  return slugs.map((slug) => {
    const base = pageName(slug);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    const stem = base.replace(/\.html$/, "");
    for (let n = 2; ; n++) {
      const candidate = `${stem}-${n}.html`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
  });
}

const STYLE = `
:root { color-scheme: light dark;
  --bg:#fff; --fg:#14161a; --dim:#5c6370; --line:#e3e6ea; --card:#f7f8fa;
  --block:#b3261e; --concern:#9a6700; --ok:#1a7f37; }
@media (prefers-color-scheme: dark) { :root {
  --bg:#14161a; --fg:#e6e8eb; --dim:#9aa0a8; --line:#2a2e35; --card:#1b1e24;
  --block:#ff6b61; --concern:#d4a017; --ok:#3fb950; } }
* { box-sizing: border-box; }
body { margin:0; padding:2rem 1rem; background:var(--bg); color:var(--fg);
  font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
main { max-width:60rem; margin:0 auto; }
h1 { font-size:1.4rem; margin:0 0 .25rem; }
h2 { font-size:1.05rem; margin:2rem 0 .5rem; }
h3 { font-size:.95rem; margin:1.25rem 0 .35rem; }
a { color:inherit; }
.sub { color:var(--dim); margin:0 0 1.5rem; font-size:.9rem; }
table { border-collapse:collapse; width:100%; font-size:.9rem; }
th,td { text-align:left; padding:.4rem .6rem; border-bottom:1px solid var(--line);
  vertical-align:top; }
th { color:var(--dim); font-weight:600; }
code,pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em; }
pre { background:var(--card); padding:.75rem; border-radius:6px; overflow-x:auto; }
.card { background:var(--card); border:1px solid var(--line); border-radius:8px;
  padding:.85rem 1rem; margin:0 0 .75rem; }
.card h3 { margin:0 0 .3rem; font-size:1rem; }
.meta { color:var(--dim); font-size:.85rem; }
.pill { display:inline-block; padding:.05rem .45rem; border-radius:999px;
  border:1px solid var(--line); font-size:.78rem; margin-right:.3rem; }
.block { color:var(--block); font-weight:600; }
.concern { color:var(--concern); font-weight:600; }
.ok { color:var(--ok); }
.gates { white-space:pre-wrap; margin:.3rem 0 0; }
.empty { color:var(--dim); font-style:italic; }
.warn { border-left:3px solid var(--concern); padding-left:.7rem; color:var(--dim);
  font-size:.85rem; }
ul.todo { list-style:none; padding-left:0; margin:.3rem 0; }
ul.todo li { padding:.1rem 0; }
`.trim();

const MERMAID_SCRIPT =
  '<script type="module">import m from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";' +
  'm.initialize({startOnLoad:true,theme:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"default"});' +
  "</script>";

function page(title: string, body: string, withMermaid: boolean): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head><body><main>",
    body,
    "</main>",
    withMermaid ? MERMAID_SCRIPT : "",
    "</body></html>",
    "",
  ].join("\n");
}

function healthPill(ws: BoardWorkstream): string {
  if (ws.healthError !== null) {
    return `<span class="pill block" title="${esc(ws.healthError)}">health unreadable</span>`;
  }
  const parts: string[] = [];
  if (ws.counts.blocking > 0) {
    parts.push(`<span class="pill block">${ws.counts.blocking} blocking</span>`);
  }
  if (ws.counts.concern > 0) {
    parts.push(`<span class="pill concern">${ws.counts.concern} concern</span>`);
  }
  if (parts.length > 0) return parts.join("");
  // Three states, not two. A clean queue says so, because on a board blank
  // and "nothing wrong" must not look the same — but an ABSENT queue has made
  // no claim at all, and rendering it "clean" would assert that a gate ran
  // and found nothing on a workstream no gate has reconciled yet.
  return ws.hasQueue
    ? '<span class="pill ok">clean</span>'
    : '<span class="pill" title="no questions.md — no gate has reconciled one yet">no queue</span>';
}

function warningsBlock(warnings: readonly string[]): string {
  if (warnings.length === 0) return "";
  return [
    "<h2>Degradations</h2>",
    ...warnings.map((w) => `<p class="warn">${esc(w)}</p>`),
  ].join("\n");
}

/** `index.html` — one card per workstream, the whole GRAPH.md board below.
 *
 *  `hrefs` is passed in rather than re-derived: `pageNames` resolves
 *  collisions positionally, so a card that called `pageName` itself would
 *  link the second of two colliding workstreams at the first one's page. */
export function renderIndex(
  model: BoardModel,
  generatedAt: string,
  hrefs: readonly string[],
): string {
  const linked = model.workstreams.map((ws, i) => ({
    ws,
    href: hrefs[i] ?? pageName(ws.slug),
  }));
  const active = linked.filter((l) => l.ws.active);
  const closed = linked.filter((l) => !l.ws.active);

  const card = ({ ws, href }: { ws: BoardWorkstream; href: string }): string =>
    [
      '<div class="card">',
      `<h3><a href="${esc(href)}">${esc(ws.slug)}</a> <span class="meta">${esc(ws.hash)}</span></h3>`,
      `<p class="meta">stage: ${esc(ws.stage)}${ws.outcomePending ? " (outcome pending)" : ""}</p>`,
      `<p>${healthPill(ws)}</p>`,
      `<pre class="gates">${esc(ws.gateSummary)}</pre>`,
      ws.focus !== null ? `<p class="meta">${esc(ws.focus)}</p>` : "",
      ws.frontmatterError !== null
        ? `<p class="warn">frontmatter does not parse (${esc(ws.frontmatterError)}) — anything above is partial</p>`
        : "",
      "</div>",
    ]
      .filter((l) => l !== "")
      .join("\n");

  const section = (title: string, list: typeof linked): string =>
    list.length === 0
      ? ""
      : [`<h2>${esc(title)} (${list.length})</h2>`, ...list.map(card)].join("\n");

  const body = [
    "<h1>devx board</h1>",
    `<p class="sub">${model.workstreams.length} workstream(s) · generated ${esc(generatedAt)} · regenerate with <code>devx board</code></p>`,
    section("Active", active),
    section("Closed", closed),
    model.workstreams.length === 0
      ? '<p class="empty">No engine workstreams — nothing to show.</p>'
      : "",
    model.mermaid !== null
      ? ["<h2>Story graph</h2>", mermaidBlock(model.mermaid)].join("\n")
      : '<p class="empty">No GRAPH.md — run <code>devx graph</code>.</p>',
    warningsBlock(model.warnings),
  ]
    .filter((l) => l !== "")
    .join("\n");

  return page("devx board", body, model.mermaid !== null);
}

function mermaidBlock(source: string): string {
  // `<pre class="mermaid">` is mermaid's own auto-render hook, and the source
  // is escaped: a node label carrying `<` would otherwise be parsed as markup
  // before mermaid ever sees it.
  return `<pre class="mermaid">${esc(source)}</pre>`;
}

/** One workstream's page: stage, gates, focus, health queue, todo, graph. */
export function renderWorkstreamPage(
  ws: BoardWorkstream,
  generatedAt: string,
): string {
  const questions =
    ws.questions.length === 0
      ? ws.healthError !== null
        ? `<p class="warn">questions.md does not parse (${esc(ws.healthError)}) — the real counts are unknown until it reads</p>`
        : '<p class="empty">No entries.</p>'
      : [
          "<table><thead><tr><th>Q</th><th>Severity</th><th>Blocks</th><th>Status</th><th>Recommendation</th></tr></thead><tbody>",
          ...ws.questions.map((q) => {
            const cls =
              q.status === "resolved"
                ? "ok"
                : q.severity === "blocking"
                  ? "block"
                  : "concern";
            return (
              `<tr><td><strong>${esc(q.id)}</strong> ${esc(q.title)}` +
              `${q.kind !== null ? `<br><span class="meta">${esc(q.kind)}</span>` : ""}</td>` +
              `<td class="${cls}">${esc(q.severity)}</td>` +
              `<td>${esc(q.blocks === "" ? "—" : q.blocks)}</td>` +
              `<td>${esc(q.status)}</td>` +
              `<td>${esc(q.recommendation === "" ? "—" : q.recommendation)}` +
              `${q.resolution !== "" ? `<br><span class="meta">resolved by ${esc(q.resolution)}</span>` : ""}</td></tr>`
            );
          }),
          "</tbody></table>",
        ].join("\n");

  const todo =
    ws.todo.length === 0
      ? '<p class="empty">No todo.md.</p>'
      : [
          '<ul class="todo">',
          ...ws.todo.map(
            (t) =>
              `<li style="padding-left:${t.depth * 1.2}rem">${t.checked ? "☑" : "☐"} ${esc(t.text)}</li>`,
          ),
          "</ul>",
        ].join("\n");

  const body = [
    `<h1>${esc(ws.slug)} <span class="meta">${esc(ws.hash)}</span></h1>`,
    `<p class="sub"><a href="index.html">← board</a> · stage: ${esc(ws.stage)}${
      ws.outcomePending ? " (outcome pending)" : ""
    } · generated ${esc(generatedAt)}</p>`,
    ws.frontmatterError !== null
      ? `<p class="warn">The plan spec's frontmatter does not parse (${esc(ws.frontmatterError)}) — every panel below is partial.</p>`
      : "",
    "<h2>Gates</h2>",
    `<pre class="gates">${esc(ws.gateSummary)}</pre>`,
    "<h2>Focus</h2>",
    ws.focus !== null
      ? `<p>${esc(ws.focus)}</p>`
      : '<p class="empty">No focus line — todo.md is absent, or no section maps to this stage.</p>',
    `<h2>Health queue ${healthPill(ws)}</h2>`,
    questions,
    "<h2>Working memory</h2>",
    todo,
    ...(ws.mermaid !== null
      ? ["<h2>Story graph</h2>", mermaidBlock(ws.mermaid)]
      : [
          "<h2>Story graph</h2>",
          '<p class="empty">No subgraph in GRAPH.md for this workstream — it has no specs, or they are all settled and collapsed to a summary node.</p>',
        ]),
  ]
    .filter((l) => l !== "")
    .join("\n");

  return page(`${ws.slug} — devx board`, body, ws.mermaid !== null);
}
