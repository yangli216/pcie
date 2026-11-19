const scalarToken = /^(?:true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/u;
const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/** Omitting every optional field is a valid empty answer. Unrelated text or keys are not. */
export function isEmptyInpatientEmrFieldMap(reply: string): boolean {
  const text = reply.trim();
  const fenced = /^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/iu.exec(text);
  try {
    const parsed: unknown = JSON.parse(fenced?.[1] ?? text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const fields = 'fieldValues' in parsed ? parsed.fieldValues : parsed;
    return fields !== null && typeof fields === 'object' && !Array.isArray(fields)
      && Object.keys(fields).length === 0;
  } catch {
    return false;
  }
}

/** Read the same template fields from a complete reply or a stream interrupted mid-string. */
export function readInpatientEmrFieldValues(reply: string, fieldIds: readonly string[]): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  const selected = new Set(fieldIds);
  let cursor = reply.indexOf('{');

  function skipWhitespace(): void {
    while (cursor < reply.length && /\s/u.test(reply[cursor])) cursor++;
  }

  function readString(): { text: string; complete: boolean } {
    let text = '';
    cursor++;
    while (cursor < reply.length) {
      const character = reply[cursor++];
      if (character === '"') return { text, complete: true };
      if (character.charCodeAt(0) < 0x20) break;
      if (character !== '\\') {
        text += character;
        continue;
      }
      const escape = reply[cursor++];
      if (escape === 'u') {
        const digits = reply.slice(cursor, cursor + 4);
        if (!/^[0-9a-f]{4}$/iu.test(digits)) break;
        text += String.fromCharCode(parseInt(digits, 16));
        cursor += 4;
      } else {
        if (!Object.prototype.hasOwnProperty.call(escapes, escape)) break;
        text += escapes[escape];
      }
    }
    return { text, complete: false };
  }

  function readNonStringValue(): string {
    const start = cursor;
    let depth = 0;
    while (cursor < reply.length) {
      const character = reply[cursor];
      if (character === '"') {
        if (!readString().complete) break;
        continue;
      }
      if (depth === 0 && (character === ',' || character === '}')) break;
      if (character === '[' || character === '{') depth++;
      if (character === ']' || character === '}') depth--;
      cursor++;
    }
    return reply.slice(start, cursor).trim();
  }

  function readFields(allowEnvelope: boolean): void {
    cursor++;
    while (cursor < reply.length) {
      skipWhitespace();
      if (reply[cursor] !== '"') break;
      const key = readString();
      if (!key.complete) break;
      skipWhitespace();
      if (reply[cursor++] !== ':') break;
      skipWhitespace();

      if (reply[cursor] === '"') {
        const value = readString();
        if (selected.has(key.text)) values[key.text] = value.text;
        if (!value.complete) break;
      } else if (allowEnvelope && key.text === 'fieldValues' && reply[cursor] === '{') {
        readFields(false);
      } else {
        const token = readNonStringValue();
        if (selected.has(key.text) && scalarToken.test(token)) values[key.text] = token;
      }
      skipWhitespace();
      if (reply[cursor] !== ',') break;
      cursor++;
    }
    if (reply[cursor] === '}') cursor++;
  }

  // Model text may wrap the field map in prose or split it into adjacent objects.
  while (cursor >= 0) {
    readFields(true);
    cursor = reply.indexOf('{', cursor);
  }
  return values;
}
