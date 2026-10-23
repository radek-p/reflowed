// The one table of commands that define or set up and typeset nothing: the
// importer (io/split.ts, a block of these is kind 'macros'), the context builder (tex/definitions.ts)
// and the caret mapper (view/edit-layout.js, a definition's body is not where text is written) all read it.
//
//   DEFINES[name]   a command that defines a name globally at the top level, with the number of
//                   mandatory arguments it reads ({group} or one token); -1: \def-like (name,
//                   parameter text, {body})
//   SETS_UP         commands that only set things up (keys, counters, styles, fonts, catcodes)
//   isSetupCommand(name), isDefinitionsCommand(name)  (the latter: either kind)

export const DEFINES: Readonly<Record<string, number>> = {
  newcommand: 2, renewcommand: 2, providecommand: 2, DeclareRobustCommand: 2, DeclareMathOperator: 2,
  NewDocumentCommand: 3, RenewDocumentCommand: 3, ProvideDocumentCommand: 3, DeclareDocumentCommand: 3,
  newenvironment: 3, renewenvironment: 3, NewDocumentEnvironment: 4, RenewDocumentEnvironment: 4, DeclareDocumentEnvironment: 4,
  newcolumntype: 2, newlength: 1, setlength: 2, addtolength: 2, newif: 1, let: 2, def: -1, gdef: -1, edef: -1, xdef: -1,
  DeclarePairedDelimiter: 3, newtheorem: 2, declaretheorem: 1, crefname: 3, Crefname: 3, definecolor: 3, colorlet: 2, newtoggle: 1,
};

export const SETS_UP: ReadonlySet<string> = new Set([
  'makeatletter', 'makeatother', 'relax', 'global', 'long', 'protected', 'tikzset', 'pgfkeys', 'pgfplotsset', 'usetikzlibrary',
  'tikzstyle', 'newcounter', 'setcounter', 'addtocounter', 'numberwithin', 'theoremstyle', 'crefformat', 'Crefformat',
  'crefrangeformat', 'creflabelformat', 'captionsetup', 'allowdisplaybreaks', 'hypersetup', 'graphicspath', 'catcode', 'sisetup',
  'setlist', 'newlist', 'DontPrintSemicolon', 'DeclareSymbolFont', 'SetSymbolFont', 'DeclareMathSymbol', 'DeclareFontShape',
  'DeclareFontFamily', 'DeclareMathAlphabet', 'DeclareTextCommand', 'DeclareUnicodeCharacter', 'pdfmapline',
  'interfootnotelinepenalty', 'widowpenalty', 'clubpenalty', 'NiceMatrixOptions',
]);

/** (algorithm2e's \SetKw… family counts as set-up) */
export const isSetupCommand = (name: string): boolean => SETS_UP.has(name) || /^SetKw[A-Za-z]*$/.test(name);
export const isDefinitionsCommand = (name: string): boolean => name in DEFINES || isSetupCommand(name);
