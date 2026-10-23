// Where a TeX line's comment starts: loading/tex-comment.ts's rule, for the engine's importers (app/src/tex/lex.ts
// re-exports it for every scanner there). \% is a percent sign, \\% a line break then a comment.
export { commentStart, stripComments } from '../../loading/tex-comment.ts';
