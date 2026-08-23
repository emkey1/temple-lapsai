/* The oracle settings. Everything that decides something here is pure, so the
 * whole of it can be checked without a key, a socket or a bill — which is the
 * point of the split, since the failure mode this replaces was "set the
 * variable, restart, find out". */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadOracle, writeOracle, describeOracle, applySettings, keyHint,
  buildRequest, extractText,
} from '../lib/oracle.js';
import { PROVIDERS, providerById, resolveOracle, oracleReady, DIALECTS } from '../public/js/providers.js';

function tmpConfig(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapsai-oracle-'));
  const file = path.join(dir, 'config.json');
  if (contents !== undefined) fs.writeFileSync(file, JSON.stringify(contents, null, 2));
  return file;
}

/* ---- the provider list ---- */

test('every provider is one the server knows how to speak to', () => {
  for (const p of PROVIDERS) {
    assert.ok(p.id && p.label, 'a provider with no name');
    assert.ok(DIALECTS.includes(p.dialect), `${p.id} speaks "${p.dialect}", which is not a dialect`);
    if (!p.custom) assert.match(p.baseUrl, /^https?:\/\//, `${p.id} has no usable endpoint`);
    assert.ok(Array.isArray(p.models), `${p.id} has no model list`);
  }
  assert.equal(new Set(PROVIDERS.map((p) => p.id)).size, PROVIDERS.length, 'two providers share an id');
});

test('the local providers need no key, and the hosted ones do', () => {
  assert.equal(providerById('ollama').keyRequired, false);
  assert.equal(providerById('lmstudio').keyRequired, false);
  assert.notEqual(providerById('openai').keyRequired, false);
  assert.ok(oracleReady(resolveOracle({ provider: 'ollama' }), false), 'a local model asked for a key');
  assert.ok(!oracleReady(resolveOracle({ provider: 'openai' }), false), 'a hosted model needs no key');
  assert.ok(oracleReady(resolveOracle({ provider: 'openai' }), true));
});

test('an unnamed provider falls back rather than half-configuring', () => {
  const r = resolveOracle({ provider: 'the-oracle-of-delphi' });
  assert.equal(r.provider, 'openai');
  assert.ok(r.baseUrl && r.model);
});

/* ---- where the settings come from ---- */

test('nothing configured at all is reported as nothing configured', () => {
  const state = loadOracle(tmpConfig(), {});
  assert.equal(state.source, 'unset');
  assert.equal(state.apiKey, '');
  assert.equal(describeOracle(state).ready, false);
});

test('the environment variables the README has always documented still work', () => {
  const state = loadOracle(tmpConfig(), { OPENAI_API_KEY: 'sk-old-habits', OPENAI_MODEL: 'gpt-4o' });
  assert.equal(state.source, 'environment');
  assert.equal(state.settings.provider, 'openai');
  assert.equal(state.settings.model, 'gpt-4o');
  assert.ok(describeOracle(state).ready);
});

test('a bare ANTHROPIC_API_KEY picks the dialect it obviously meant', () => {
  const state = loadOracle(tmpConfig(), { ANTHROPIC_API_KEY: 'sk-ant-xyz' });
  assert.equal(state.settings.provider, 'anthropic');
  assert.equal(state.settings.dialect, 'anthropic');
  assert.equal(state.apiKey, 'sk-ant-xyz');
});

test('the old config.json shapes are still read', () => {
  const nested = loadOracle(tmpConfig({ openai: { apiKey: 'sk-nested', model: 'gpt-4o-mini' } }), {});
  assert.equal(nested.apiKey, 'sk-nested');
  const flat = loadOracle(tmpConfig({ apiKey: 'sk-flat' }), {});
  assert.equal(flat.apiKey, 'sk-flat');
});

test('what the menu saved outranks the environment, and FORGET gives it back', () => {
  const file = tmpConfig();
  const env = { OPENAI_API_KEY: 'sk-from-the-shell' };
  let state = loadOracle(file, env);
  assert.equal(state.source, 'environment');

  const next = applySettings(state, { provider: 'ollama', model: 'llama3.1', baseUrl: 'http://localhost:11434/v1' });
  writeOracle(file, next.settings, next.apiKey);
  state = loadOracle(file, env);
  assert.equal(state.source, 'saved');
  assert.equal(state.settings.provider, 'ollama');

  writeOracle(file, null);
  state = loadOracle(file, env);
  assert.equal(state.source, 'environment');
  assert.equal(state.apiKey, 'sk-from-the-shell');
});

test('saving the oracle leaves the rest of config.json alone', () => {
  const file = tmpConfig({ somethingElse: { keep: true } });
  writeOracle(file, resolveOracle({ provider: 'openai', model: 'gpt-4o-mini' }), 'sk-1');
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(written.somethingElse, { keep: true });
  assert.equal(written.oracle.apiKey, 'sk-1');
});

test('the file holding the key is not readable by the rest of the machine', () => {
  const file = tmpConfig();
  writeOracle(file, resolveOracle({ provider: 'openai', model: 'gpt-4o-mini' }), 'sk-secret');
  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(mode, 0o600, `config.json is mode ${mode.toString(8)}`);
});

/* ---- what the browser is allowed to know ---- */

test('the key never comes back out of the server', () => {
  const state = loadOracle(tmpConfig({ oracle: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-super-secret-1234' } }), {});
  const shown = JSON.stringify(describeOracle(state));
  assert.ok(!shown.includes('sk-super-secret-1234'), 'the API key was sent to the browser');
  assert.ok(!shown.includes('super-secret'), 'part of the API key was sent to the browser');
  assert.ok(shown.includes('1234'), 'no way to tell which key is bound');
  assert.equal(describeOracle(state).current.hasKey, true);
});

test('a key hint is a hint, not a key', () => {
  assert.equal(keyHint(''), '');
  assert.equal(keyHint('sk-abcdefgh'), '…efgh');
  assert.equal(keyHint('ab'), '…ab');
});

/* ---- accepting a change ---- */

test('an empty key field keeps the key you already have', () => {
  const state = { settings: resolveOracle({ provider: 'openai' }), apiKey: 'sk-keep-me', source: 'saved' };
  const next = applySettings(state, { provider: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', apiKey: '' });
  assert.equal(next.apiKey, 'sk-keep-me');
  assert.equal(next.settings.model, 'gpt-4o');
});

test('clearing the key takes deliberate aim', () => {
  const state = { settings: resolveOracle({ provider: 'openai' }), apiKey: 'sk-keep-me', source: 'saved' };
  const next = applySettings(state, { provider: 'openai', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', clearKey: true });
  assert.equal(next.apiKey, '');
});

test('an endpoint that is not an endpoint is refused', () => {
  const state = { settings: resolveOracle({}), apiKey: '', source: 'unset' };
  const bad = (body) => assert.throws(() => applySettings(state, body), /endpoint|address|model/);
  bad({ provider: 'custom', model: 'x', baseUrl: 'file:///etc/passwd' });
  bad({ provider: 'custom', model: 'x', baseUrl: 'not a url' });
  bad({ provider: 'custom', model: 'x', baseUrl: '' });
  bad({ provider: 'custom', model: '', baseUrl: 'https://example.test/v1' });

  /* A known provider left blank falls back to its own default rather than
   * failing — there is a right answer, so asking again would be theatre. */
  const filled = applySettings(state, { provider: 'openai', model: '', baseUrl: '' });
  assert.equal(filled.settings.model, providerById('openai').models[0]);
  assert.equal(filled.settings.baseUrl, providerById('openai').baseUrl);
});

test('a trailing slash on the endpoint does not become a double slash', () => {
  const state = { settings: resolveOracle({}), apiKey: 'k', source: 'saved' };
  const next = applySettings(state, { provider: 'custom', model: 'm', baseUrl: 'https://example.test/v1/' });
  assert.equal(buildRequest(next.settings, 'k', 'hi').url, 'https://example.test/v1/chat/completions');
});

/* ---- the shape of the request, without making one ---- */

test('the OpenAI dialect asks the way OpenAI expects to be asked', () => {
  const req = buildRequest(resolveOracle({ provider: 'openai', model: 'gpt-4o-mini' }), 'sk-1', 'write a dungeon');
  assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(req.headers.Authorization, 'Bearer sk-1');
  assert.equal(req.body.model, 'gpt-4o-mini');
  assert.equal(req.body.messages.at(-1).content, 'write a dungeon');
  assert.equal(req.body.messages[0].role, 'system');
});

test('the Anthropic dialect asks the way Anthropic expects to be asked', () => {
  const req = buildRequest(resolveOracle({ provider: 'anthropic', model: 'claude-sonnet-4-5' }), 'sk-ant-1', 'write a dungeon');
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.headers['x-api-key'], 'sk-ant-1');
  assert.match(req.headers['anthropic-version'], /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!req.headers.Authorization, 'sent a bearer token to an x-api-key endpoint');
  assert.ok(req.body.max_tokens > 0, 'Anthropic refuses a request with no max_tokens');
  assert.equal(req.body.system.length > 0, true, 'the system prompt went missing');
  assert.equal(req.body.messages[0].content, 'write a dungeon');
});

test('a local model is asked without an Authorization header at all', () => {
  const req = buildRequest(resolveOracle({ provider: 'ollama', model: 'llama3.1' }), '', 'hello');
  assert.equal(req.url, 'http://localhost:11434/v1/chat/completions');
  assert.ok(!('Authorization' in req.headers), 'an empty bearer is worse than none');
});

test('both dialects are read back out of their own answer', () => {
  assert.equal(extractText('openai', { choices: [{ message: { content: '{"a":1}' } }] }), '{"a":1}');
  assert.equal(extractText('anthropic', { content: [{ type: 'text', text: '{"a":1}' }] }), '{"a":1}');
  /* Some OpenAI-compatible servers answer in parts. */
  assert.equal(extractText('openai', { choices: [{ message: { content: [{ text: '{"a":' }, { text: '1}' }] } }] }), '{"a":1}');
  /* Anthropic interleaves thinking blocks with text ones. */
  assert.equal(extractText('anthropic', { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'ok' }] }), 'ok');
});

test('an empty answer reads as empty rather than as "undefined"', () => {
  for (const d of DIALECTS) {
    assert.equal(extractText(d, null), '');
    assert.equal(extractText(d, {}), '');
  }
  assert.equal(extractText('openai', { choices: [] }), '');
});
