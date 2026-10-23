// (display + capture fidelity): what happens to a block's output.json
// after the converter (engine-api's convert.ts, attrs on) and slots
// (applySlots), before the sourcemap, the JSON and the encoder. compile.ts
// and what it calls (displays.ts, fidelity/*).
import { modelDisplays, type DisplayStats, type Resample } from './displays.ts';
import { splitPrivateLigatures, type LigatureStats } from './fidelity/ligatures.ts';
import { linkFootnoteMarks, type FootnoteStats } from './fidelity/footnotes.ts';

type J = Record<string, any>;
export interface PostConvertInputs {
  /** the capture stream as convert.ts read it (pictures marked) */
  stream: string;
  /** the run's files and the bundle's (fonts, maps) */
  readFile: (name: string) => Uint8Array | null;
  /** route 2's samples: the block compiled wider (fidelity/resample.ts
   *  `resampler`); called only when a display route 1 cannot place is there */
  resample?: Resample;
}
export interface PostConvertStats { displays: DisplayStats; ligatures: LigatureStats; footnotes: FootnoteStats }

/** Mutates `output`. */
export function postConvert(output: J, inp: PostConvertInputs): PostConvertStats {
  // V3: route 1, then samples → the viewer's affine model (first: the samples are compared with the tree as converted)
  const displays = modelDisplays(output, inp.resample);
  const ligatures = splitPrivateLigatures(output, inp.stream, inp.readFile);
  const footnotes = linkFootnoteMarks(output);
  return { displays, ligatures, footnotes };
}
