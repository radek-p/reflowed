// A document of another core version (store/policy.ts) opens read-only: shown, never written (the
// store refuses every write; the app does not try).
//   isReadOnly(doc)     true for such a document (the store marks it on read: doc.readOnly)
//   readOnlyNote(doc)   what the reader is told (the toast on open and on any attempt to edit; the save status)
//   newer core ('newer-schema'): READ_ONLY_NOTE; older core ('older-core'): OLDER_NOTE, with the prompt to export
//   it and start anew (app/older-core.js)
export const isReadOnly = (doc) => !!doc?.readOnly;
export const READ_ONLY_NOTE = 'This document was saved by a newer version of ReflowEd. It is read-only here: open it in that version to edit it.';
export const OLDER_NOTE = 'This document was made by an older ReflowEd. Export it (.tex/.zip) and start anew; to keep editing it, use the older build.';
export const readOnlyNote = (doc) => (doc?.readOnly === 'older-core' ? OLDER_NOTE : READ_ONLY_NOTE);
