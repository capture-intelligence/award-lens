/**
 * RFC 4180-compliant CSV parser — handles quoted fields, embedded quotes,
 * embedded newlines, and CRLF line endings.
 *
 * Streaming-style: accepts the full text but yields rows lazily so you can
 * pipe into async writes without buffering the entire parsed result.
 */
export function* parseCsv(text: string): Generator<string[]> {
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text.charCodeAt(i);

    if (inQuotes) {
      if (ch === 34) { // "
        if (i + 1 < len && text.charCodeAt(i + 1) === 34) {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += text[i];
      i++;
      continue;
    }

    if (ch === 34) {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === 44) { // ,
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === 13) { // \r — treat CRLF as LF
      i++;
      continue;
    }
    if (ch === 10) { // \n
      row.push(field);
      yield row;
      field = '';
      row = [];
      i++;
      continue;
    }
    field += text[i];
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

/**
 * Convenience: parse CSV text into an array of row objects keyed by header.
 * For very large files prefer parseCsv() directly and stream into the DB.
 */
export function parseCsvToObjects(text: string): Record<string, string>[] {
  const iter = parseCsv(text);
  const first = iter.next();
  if (first.done) return [];
  const headers = first.value;
  const out: Record<string, string>[] = [];
  for (const row of iter) {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]!] = row[i] ?? '';
    out.push(obj);
  }
  return out;
}
