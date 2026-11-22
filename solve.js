// csv-reader 1.0.0 drop-in, rewritten for speed. Same answer, same policy.
//
// The reference walks character by character and builds every field one character at a time. This
// one takes the line that a record starts on and, when that line holds no quote, splits it with the
// native engine in one call. Only a record that actually contains a quote (or a stray CR) falls
// back to the character-level policy, which is written out in full below.
//
// Contract: run({text, header}) -> {columns, rows, errors}, identical to csv-reader 1.0.0.

const COMMA = 44;
const LF = 10;
const CR = 13;
const DQ = 34;

const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_END = 2;

// The first comma, CR or LF at or after lastIndex.
const DELIM = /[,\r\n]/g;
// The first CR LF or LF at or after lastIndex: where the line a record starts on ends.
const BREAK = /\r\n|\n/g;
// Inside a quoted field: every CRLF, lone CR and LF each count one line and all three read as LF.
const EOL = /\r\n|\r|\n/g;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters up to the next comma or line break. A CR not followed by LF is dropped
  // (stray_cr). `added` counts the characters kept, which is what tells quote_junk.
  function readUnquoted(value, start) {
    let added = 0;
    let v = value;
    let p = start;
    for (;;) {
      DELIM.lastIndex = p;
      const m = DELIM.exec(text);
      const idx = m === null ? n : m.index;
      if (idx > p) {
        v += text.slice(p, idx);
        added += idx - p;
        p = idx;
      }
      if (m === null) {
        pos = p;
        return { value: v, ended: ENDED_END, added };
      }
      const c = text.charCodeAt(p);
      if (c === COMMA) {
        pos = p + 1;
        return { value: v, ended: ENDED_COMMA, added };
      }
      if (c === LF) {
        pos = p + 1;
        line += 1;
        return { value: v, ended: ENDED_BREAK, added };
      }
      if (text.charCodeAt(p + 1) === LF) {
        pos = p + 2;
        line += 1;
        return { value: v, ended: ENDED_BREAK, added };
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      p += 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let i = open + 1;
    let close = -1;
    for (;;) {
      const j = text.indexOf('"', i);
      if (j < 0) break;
      if (text.charCodeAt(j + 1) === DQ) {
        i = j + 2; // a doubled quote is one quote inside the field
        continue;
      }
      close = j;
      break;
    }
    if (close < 0) {
      // The quote never closes: it is a literal character, and the text after it is read unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"', open + 1);
    }
    const raw = text.slice(open + 1, close);
    pos = close + 1;
    let lines = 0;
    const flat = raw.replace(EOL, () => {
      lines += 1;
      return '\n';
    });
    line += lines;
    const value = flat.replace(/""/g, '"');
    if (pos >= n) return { value, ended: ENDED_END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === COMMA) {
      pos += 1;
      return { value, ended: ENDED_COMMA, added: 0 };
    }
    if (c === LF) {
      pos += 1;
      line += 1;
      return { value, ended: ENDED_BREAK, added: 0 };
    }
    if (c === CR && text.charCodeAt(pos + 1) === LF) {
      pos += 2;
      line += 1;
      return { value, ended: ENDED_BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value, pos);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Where the line this record starts on ends: the first LF, and a CR right before it belongs to
    // that break.
    const nl = text.indexOf('\n', pos);
    let end;
    let next;
    if (nl < 0) {
      end = n;
      next = n;
    } else if (nl > pos && text.charCodeAt(nl - 1) === CR) {
      end = nl - 1;
      next = nl + 1;
    } else {
      end = nl;
      next = nl + 1;
    }
    const raw = text.slice(pos, end);

    let fields;
    let quoted = false;

    if (raw.indexOf('"') < 0) {
      // No quote anywhere on this line: every field is plain text.
      pos = next;
      if (nl >= 0) line += 1;
      if (raw.indexOf('\r') < 0) {
        fields = raw.split(',');
      } else {
        // Every CR here is a lone one (the line's own break is excluded), so each is dropped.
        const parts = raw.split('\r');
        for (let k = 1; k < parts.length; k++) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        }
        fields = parts.join('').split(',');
      }
    } else {
      fields = [];
      for (;;) {
        quoted = text.charCodeAt(pos) === DQ;
        const field = quoted ? readQuoted() : readUnquoted('', pos);
        fields.push(field.value);
        if (field.ended !== ENDED_COMMA) break;
      }
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      const extra = fields.splice(width);
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns === null ? [] : columns) : null, rows, errors };
}