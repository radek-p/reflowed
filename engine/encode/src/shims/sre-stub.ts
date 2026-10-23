// speech-rule-engine, not bundled: mathml.ts's speaker() then returns null (no
// alttext). A Tectonic capture carries no MathML, so there is nothing to speak;
// see NOTES.md for what bundling it would take.
throw new Error('speech-rule-engine is not bundled');
