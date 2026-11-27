// Self-check for the terminal output tail (replayed into a detached window).
// Run: node scripts/check-terminal-tail.mjs
import { equal, ok } from 'node:assert/strict';
import { appendTail } from '../src/components/terminal/outputTail.ts';

equal(appendTail('ab', 'cd', 10), 'abcd');                        // under the cap: unchanged
const t = appendTail('line1\nline2\n', 'line3\nline4\n', 14);
ok(t.length <= 14, `over cap: ${t.length}`);
equal(t, 'line3\nline4\n');                                            // cut at the first line start
equal(appendTail('', 'abcdefghij', 4), 'ghij');                   // no newline: plain last max
console.log('check-terminal-tail: OK');
