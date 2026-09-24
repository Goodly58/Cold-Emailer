import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

import {
  AiOutputError,
  AiRefusalError,
  AiUnavailableError,
  aiErrorResponse,
  aiResearch,
  aiStructured,
  setAiClientForTests,
  usageOf,
  type AiClient,
} from '../lib/ai';
import { cleanCvText, wordCount } from '../lib/cv';

/**
 * The model is never called in tests. A fake client records each request so
 * the tests can assert on what the app would have sent, and returns scripted
 * responses so every branch of the handling code runs.
 */
type Captured = Record<string, unknown>;

function fakeClient(opts: {
  parse?: (params: Captured) => unknown;
  create?: (params: Captured, call: number) => unknown;
}): AiClient & { calls: Captured[] } {
  const calls: Captured[] = [];
  let n = 0;
  const client = {
    calls,
    beta: {
      messages: {
        parse: async (params: Captured) => {
          calls.push(params);
          return opts.parse!(params);
        },
        create: async (params: Captured) => {
          calls.push(params);
          return opts.create!(params, n++);
        },
      },
    },
  };
  return client as unknown as AiClient & { calls: Captured[] };
}

test.afterEach(() => setAiClientForTests(null));

/* ------------------------------------------------------------ requests */

test('aiStructured sends the documented request shape', async () => {
  const fake = fakeClient({
    parse: () => ({
      stop_reason: 'end_turn',
      model: 'claude-opus-5',
      parsed_output: { ok: true },
      usage: { input_tokens: 1000, output_tokens: 200 },
    }),
  });
  setAiClientForTests(fake);

  const { data, usage } = await aiStructured({
    system: 'sys',
    content: 'hello',
    schema: z.object({ ok: z.boolean() }),
    effort: 'low',
  });

  assert.deepEqual(data, { ok: true });
  const req = fake.calls[0];
  assert.equal(req.model, 'claude-opus-5');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.equal((req.output_config as { effort: string }).effort, 'low');
  assert.ok((req.output_config as { format?: unknown }).format, 'structured output format must be set');
  // Server-side refusal fallback is opted into on every request.
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  // Opus 5: $5 in, $25 out per million tokens.
  assert.equal(usage.costUsd, 0.01);
});

test('a refusal becomes a typed error, not a crash on missing output', async () => {
  setAiClientForTests(
    fakeClient({ parse: () => ({ stop_reason: 'refusal', stop_details: { explanation: 'nope' }, parsed_output: null }) })
  );
  await assert.rejects(
    () => aiStructured({ system: 's', content: 'c', schema: z.object({}) }),
    AiRefusalError
  );
});

test('a truncated response is reported rather than half-parsed', async () => {
  setAiClientForTests(fakeClient({ parse: () => ({ stop_reason: 'max_tokens', parsed_output: null }) }));
  await assert.rejects(() => aiStructured({ system: 's', content: 'c', schema: z.object({}) }), /cut off/);
});

test('output that fails the schema is an error', async () => {
  setAiClientForTests(fakeClient({ parse: () => ({ stop_reason: 'end_turn', parsed_output: null }) }));
  await assert.rejects(() => aiStructured({ system: 's', content: 'c', schema: z.object({}) }), AiOutputError);
});

test('with no API key the feature is unavailable, not broken', async () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    await assert.rejects(() => aiStructured({ system: 's', content: 'c', schema: z.object({}) }), AiUnavailableError);
    assert.equal(aiErrorResponse(new AiUnavailableError()).status, 503);
  } finally {
    if (saved.key) process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  }
});

/* ------------------------------------------------------------ research */

const Found = z.object({ items: z.array(z.string()) });
const recordTool = { name: 'record_items', description: 'Record findings' };

test('aiResearch returns the recorded findings and counts searches', async () => {
  const fake = fakeClient({
    create: () => ({
      stop_reason: 'tool_use',
      model: 'claude-opus-5',
      usage: { input_tokens: 5000, output_tokens: 500 },
      content: [
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
        { type: 'server_tool_use', id: 's2', name: 'web_search', input: { query: 'y' } },
        { type: 'tool_use', id: 't1', name: 'record_items', input: { items: ['a', 'b'] } },
      ],
    }),
  });
  setAiClientForTests(fake);

  const out = await aiResearch({ system: 's', prompt: 'p', schema: Found, recordTool });
  assert.deepEqual(out.data, { items: ['a', 'b'] });
  assert.equal(out.searches, 2);

  const tools = fake.calls[0].tools as Array<Record<string, unknown>>;
  assert.equal(tools[0].type, 'web_search_20260209');
  const schema = tools[1].input_schema as Record<string, unknown>;
  assert.equal(schema.type, 'object');
  assert.equal(schema.$schema, undefined, 'the JSON Schema draft marker is stripped');
});

test('aiResearch resumes a paused server-tool turn', async () => {
  const fake = fakeClient({
    create: (_p, call) =>
      call === 0
        ? { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], usage: { input_tokens: 10, output_tokens: 10 } }
        : { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'record_items', input: { items: [] } }], usage: { input_tokens: 10, output_tokens: 10 } },
  });
  setAiClientForTests(fake);

  const out = await aiResearch({ system: 's', prompt: 'p', schema: Found, recordTool });
  assert.deepEqual(out.data, { items: [] });
  // The paused assistant turn is sent back as-is so the server can continue it.
  const second = fake.calls[1].messages as Array<{ role: string }>;
  assert.equal(second[second.length - 1].role, 'assistant');
});

test('aiResearch hands schema errors back to the model to correct', async () => {
  const fake = fakeClient({
    create: (_p, call) =>
      call === 0
        ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'bad', name: 'record_items', input: { items: 'not-a-list' } }], usage: { input_tokens: 1, output_tokens: 1 } }
        : { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'ok', name: 'record_items', input: { items: ['fixed'] } }], usage: { input_tokens: 1, output_tokens: 1 } },
  });
  setAiClientForTests(fake);

  const out = await aiResearch({ system: 's', prompt: 'p', schema: Found, recordTool });
  assert.deepEqual(out.data, { items: ['fixed'] });
  const retry = fake.calls[1].messages as Array<{ role: string; content: unknown }>;
  const last = retry[retry.length - 1].content as Array<{ type: string; is_error?: boolean; tool_use_id: string }>;
  assert.equal(last[0].type, 'tool_result');
  assert.equal(last[0].is_error, true);
  assert.equal(last[0].tool_use_id, 'bad');
});

test('aiResearch nudges a model that finishes without recording', async () => {
  const fake = fakeClient({
    create: (_p, call) =>
      call === 0
        ? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is what I found…' }], usage: { input_tokens: 1, output_tokens: 1 } }
        : { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'record_items', input: { items: ['x'] } }], usage: { input_tokens: 1, output_tokens: 1 } },
  });
  setAiClientForTests(fake);
  const out = await aiResearch({ system: 's', prompt: 'p', schema: Found, recordTool });
  assert.deepEqual(out.data, { items: ['x'] });
});

test('aiResearch gives up after its round limit', async () => {
  setAiClientForTests(
    fakeClient({ create: () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '…' }], usage: { input_tokens: 1, output_tokens: 1 } }) })
  );
  await assert.rejects(
    () => aiResearch({ system: 's', prompt: 'p', schema: Found, recordTool, maxRounds: 2 }),
    AiOutputError
  );
});

/* ------------------------------------------------------------------- CV */

test('usageOf prices known models and falls back sensibly', () => {
  assert.equal(usageOf('claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 }).costUsd, 2);
  assert.equal(usageOf('some-future-model', { input_tokens: 1_000_000, output_tokens: 0 }).costUsd, 5);
});

test('cleanCvText normalises pasted text', () => {
  const messy = 'Name\r\n\r\n\r\n\r\nExperience \t\nBank​ Analyst';
  assert.equal(cleanCvText(messy), 'Name\n\nExperience\nBank Analyst');
  assert.equal(wordCount('  one two\nthree '), 3);
  assert.equal(wordCount(''), 0);
});

test('the CV endpoint stores pasted text without AI, and keeps profile edits', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-'));
  const file = path.join(dir, 'db.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      profile: { name: 'Typed Myself', headline: '', phone: '', linkedinUrl: '' },
      companies: [], contacts: [], applications: [], outreach: [], templates: [], jobSources: [], runs: [], events: [],
    })
  );
  process.env.DB_PATH = file;
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    const { POST, GET } = await import('../app/api/cv/route');
    const cv = 'Experience\n' + 'Data analyst at a bank, building dashboards and models. '.repeat(20);
    const res = await POST(new Request('http://x/api/cv', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: cv }),
    }) as never);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.usedAi, false);
    assert.equal(body.profile.cvSource, 'text');
    assert.equal(body.profile.name, 'Typed Myself', 'nothing typed by hand is overwritten');

    // The text lives in the blob store, not in the main database file.
    const main = await fs.readFile(file, 'utf8');
    assert.ok(!main.includes('building dashboards'), 'CV text must not bloat every database read');
    const got = await (await GET()).json();
    assert.equal(got.hasCv, true);
    assert.ok(got.text.includes('building dashboards'));

    const tooShort = await POST(new Request('http://x/api/cv', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    }) as never);
    assert.equal(tooShort.status, 400);
  } finally {
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  }
});
