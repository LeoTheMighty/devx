// `codeOnly` — blank every string/template/regex body and every comment,
// keeping offsets, so a source scan sees CODE and not the prose that names the
// same things.
//
// Extracted at dlr107, where a third scanner needed it. It was already
// byte-identical in `engine-layout-single-reader.test.ts` (dlr105) and
// `engine-layout-map.test.ts` (dlr101); three hand-kept copies of a parser
// wrapper is how one of them quietly drifts and starts reporting a false zero.
//
// Parsed with TypeScript's own parser: two hand-rolled versions of this in
// earlier evals silently mangled devx's own source, and a scanner that quietly
// blanks a file reports zero findings and a false GREEN.

import ts from "typescript";

export function codeOnly(src: string): string {
  const sf = ts.createSourceFile("scan.ts", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const buf = src.split("");
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < buf.length; i++) if (buf[i] !== "\n") buf[i] = " ";
  };
  const walk = (n: ts.Node): void => {
    switch (n.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.RegularExpressionLiteral:
        blank(n.getStart(sf) + 1, n.end - 1);
        return;
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
        blank(n.getStart(sf) + 1, n.end - 2);
        return;
      case ts.SyntaxKind.TemplateTail:
        blank(n.getStart(sf) + 1, n.end - 1);
        return;
      default:
        ts.forEachChild(n, walk);
    }
  };
  ts.forEachChild(sf, walk);
  return buf
    .join("")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}
