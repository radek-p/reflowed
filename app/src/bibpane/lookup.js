// BibTeX for a DOI or an arXiv id, when the page is online. Only when
// asked (the Add dialog's "Look up"); the single file makes no request else.
//
// doi.org content negotiation (Accept: application/x-bibtex) answers with
// CORS headers for any origin (also `null`, file://): Crossref DOIs redirect
// to api.crossref.org, DataCite ones (arXiv's 10.48550/arXiv.<id>) to
// data.crosscite.org, both `Access-Control-Allow-Origin: *`. arXiv's own export API sends no CORS headers, so an arXiv id
// goes through its DataCite DOI.
import { parseIdentifier } from '../bib/library.ts';

export class LookupError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }   // kind: 'offline' | 'not-found' | 'failed' | 'bad-id'
}

/** -> { bibtex, id: {kind, id}, doi, source: 'doi.org' } */
export async function lookupBibtex(input, { fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const id = parseIdentifier(input);
  if (!id) throw new LookupError('That is not a DOI (10.xxxx/…) or an arXiv id (2602.12926).', 'bad-id');
  if (globalThis.navigator && navigator.onLine === false) throw new LookupError('You are offline, so the record cannot be fetched. Paste the BibTeX instead.', 'offline');
  const doi = id.kind === 'arxiv' ? `10.48550/arXiv.${id.id}` : id.id;
  const url = `https://doi.org/${encodeURI(doi).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetchImpl(url, { headers: { Accept: 'application/x-bibtex; charset=utf-8' }, signal: ctl.signal, credentials: 'omit' });
  } catch (e) {
    throw new LookupError(ctl.signal.aborted ? 'doi.org did not answer in time. Try again, or paste the BibTeX instead.'
      : 'Could not reach doi.org (offline, or blocked here). Paste the BibTeX instead: the publisher\'s page usually has "Cite" or "Export citation".', 'offline');
  } finally { clearTimeout(timer); }
  if (r.status === 404) throw new LookupError(`No record for ${id.kind === 'arxiv' ? `arXiv:${id.id}` : doi}. Check the id, or paste the BibTeX instead.`, 'not-found');
  if (!r.ok) throw new LookupError(`doi.org answered ${r.status}. Try again later, or paste the BibTeX instead.`, 'failed');
  const text = (await r.text()).trim();
  if (!/^@\s*\w+\s*[{(]/.test(text)) throw new LookupError('The answer was not BibTeX. Paste the BibTeX instead.', 'failed');
  return { bibtex: text, id, doi, source: 'doi.org' };
}
