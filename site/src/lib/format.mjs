import { format } from 'prettier';

const width = 80;

// Breaks a run of whole-line `//` comments again at the page's width. A run that already fits
// stays as its author wrote it, so a list in a comment keeps its lines.
function rewrapComments(code) {
  return code.replace(/(?:^[ \t]*\/\/ .*\n?)+/gm, (run) => {
    if (run.split('\n').every((line) => line.length <= width)) return run;
    const indent = /^[ \t]*/.exec(run)[0];
    const words = run.split('\n').flatMap((line) => line.replace(/^[ \t]*\/\/ ?/, '').split(' ')).filter(Boolean);
    const lines = [];
    for (const word of words) {
      const last = lines.at(-1);
      if (last !== undefined && `${indent}// ${last} ${word}`.length <= width) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines.map((line) => `${indent}// ${line}`).join('\n') + (run.endsWith('\n') ? '\n' : '');
  });
}

/**
 * A snippet laid out for reading: one statement to a line, at most 80 columns. The repository
 * keeps many examples on one long line, which is right for `execute` and hard to read on a page.
 * The layout and the punctuation change; what the code does stays the same.
 */
export async function formatSnippet(code) {
  // The babel parser accepts the top-level `await` and `return` that `execute` allows.
  const formatted = await format(code, { parser: 'babel', printWidth: width, singleQuote: true });
  return rewrapComments(formatted).trimEnd();
}
