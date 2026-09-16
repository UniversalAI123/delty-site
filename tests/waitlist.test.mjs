import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
function setup(fetchResult = () => Promise.resolve({ ok: true })) {
  const input = { value: 'test@example.invalid', valid: true, checkValidity() { return this.valid; }, reportValidity() { this.reported = true; } };
  const button = { disabled: false, textContent: "Tell me when it's live" };
  const note = { textContent: '' };
  let submit;
  const form = { querySelector(s) { return s === 'button' ? button : s.includes('email') ? input : { value: 'direct' }; }, parentNode: { querySelector: () => note }, addEventListener: (_, fn) => { submit = fn; } };
  const timers = new Map(); const requests = []; let serial = 0;
  const window = { location: { href: 'unchanged' } };
  vm.runInNewContext(script, { window, location: { search: '' }, URLSearchParams, AbortController,
    document: { querySelectorAll: s => s === 'form.cta' ? [form] : [] },
    setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
    fetch: (...args) => { requests.push(args); return fetchResult(...args); },
  });
  return { input, button, note, requests, timers, window, submit: () => submit({ preventDefault() {} }) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('invalid email never sends a request', () => {
  const s = setup(); s.input.valid = false; s.submit();
  assert.equal(s.requests.length, 0); assert.equal(s.input.reported, true);
  assert.doesNotMatch(html, /novalidate/);
});
test('success confirms only once and clears the email after acknowledgement', async () => {
  const s = setup(); s.submit(); s.submit(); await flush();
  assert.equal(s.requests.length, 1); assert.equal(s.input.value, '');
  assert.match(s.button.textContent, /on the list/); assert.equal(s.timers.size, 0);
});
test('HTTP failure preserves email and offers retry without opening mail', async () => {
  const s = setup(() => Promise.resolve({ ok: false })); s.submit(); await flush();
  assert.equal(s.input.value, 'test@example.invalid'); assert.equal(s.button.disabled, false);
  assert.match(s.note.textContent, /could not confirm/); assert.equal(s.window.location.href, 'unchanged');
});
test('network rejection recovers the form', async () => {
  const s = setup(() => Promise.reject(new Error('offline'))); s.submit(); await flush();
  assert.equal(s.button.disabled, false); assert.match(s.note.textContent, /Try again/);
});
test('timeout aborts request and ignores a late success', async () => {
  let resolve; const s = setup(() => new Promise(r => { resolve = r; })); s.submit();
  [...s.timers.values()][0]();
  assert.equal(s.requests[0][1].signal.aborted, true); assert.equal(s.button.disabled, false);
  resolve({ ok: true }); await flush();
  assert.equal(s.input.value, 'test@example.invalid'); assert.match(s.note.textContent, /could not confirm/);
});
test('both forms have visible status copy and privacy disclosure', () => {
  assert.equal((html.match(/class="cta-note" role="status"/g) || []).length, 2);
  assert.equal((html.match(/href="\/privacy.html#launch-list"/g) || []).length, 2);
});
