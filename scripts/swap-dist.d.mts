// Types for scripts/swap-dist.mjs (b931a1).
//
// The script is plain ESM JavaScript — it runs as an npm script step, before
// and independently of any build — but `test/swap-dist.test.ts` imports it,
// and `tsc --noEmit` covers `test/`. Without a declaration the import is an
// implicit `any` and the typecheck leg of `npm test` fails.

export interface SwapDistIo {
  /** Success output sink. Default: process.stdout. */
  log?: (s: string) => void;
  /** Warning/failure output sink. Default: process.stderr. */
  warn?: (s: string) => void;
  /** Clock, for the stale-lock threshold. Default: Date.now. */
  now?: () => number;
}

/**
 * Swap `<repoRoot>/dist.next` into place as `<repoRoot>/dist`, under an
 * O_EXCL lock so two concurrent `build:swap` runs cannot interleave.
 *
 * Returns 0 on success OR when a live peer holds the lock (that peer is
 * installing the same merged HEAD, so deferring is the right answer, not a
 * failure); 1 when the swap could not be performed.
 */
export function swapDist(repoRoot: string, io?: SwapDistIo): number;
