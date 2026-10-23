// The kit's Island: an element Preact renders once and never touches again. Its contents (CodeMirror, the viewer's
// typeset block, a DocumentView) belong to someone else; its attributes are the first render's (later changes to
// them are made imperatively). The one rule for every such element, instead of a local
// shouldComponentUpdate() { return false } in each module.
//
//   html`<${Island} class="cm-island" />`   ·   html`<${Island} tag="pre" class="blk-preview" hidden=${true} />`
import { Component } from 'preact';
import { html } from './core.js';

export class Island extends Component {
  shouldComponentUpdate() { return false; }
  render({ tag = 'div', children: _ignored, ...p }) { return html`<${tag} ...${p}></${tag}>`; }
}
