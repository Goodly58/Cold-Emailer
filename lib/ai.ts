import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

/**
 * The one place the app talks to Claude. Server-side only: it reads the API
 * key from the environment, so nothing here may be imported by a client
 * component.
 *
 * Every AI feature degrades gracefully: with no key configured, callers get
 * an AiUnavailableError and the UI explains how to switch it on, while the
 * rest of the app works as before.
 */

export const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

/** Server-side fallback: if the model declines on policy grounds, the API
 *  re-runs the request on Anthropic's recommended substitute instead of
 *  returning a refusal. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Published per-million-token rates, used only to show an approximate cost. */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Web search is billed per search as well as for the tokens its results add. */
const SEARCH_PRICE_USD = 0.01;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export class AiUnavailableError extends Error {
  constructor() {
    super('AI features are off: add ANTHROPIC_API_KEY to your environment variables to switch them on.');
    this.name = 'AiUnavailableError';
  }
}

export class AiRefusalError extends Error {
  constructor(detail?: string | null) {
    super(`The model declined this request${detail ? `: ${detail}` : '.'}`);
    this.name = 'AiRefusalError';
  }
}

export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiOutputError';
  }
}

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Approximate cost in US dollars at list prices. */
  costUsd: number;
}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/* The narrow slice of the SDK this module uses, so tests can substitute a
 * fake without a network or a key. */
type BetaMessages = Pick<Anthropic['beta']['messages'], 'create' | 'parse'>;
export interface AiClient {
  beta: { messages: BetaMessages };
}

let testClient: AiClient | null = null;
let liveClient: Anthropic | null = null;

/** Test hook: route every call through a fake client. Pass null to reset. */
export function setAiClientForTests(client: AiClient | null): void {
  testClient = client;
}

function getClient(): AiClient {
  if (testClient) return testClient;
  if (!aiConfigured()) throw new AiUnavailableError();
  if (!liveClient) liveClient = new Anthropic({ maxRetries: 2 });
  return liveClient;
}

export function usageOf(model: string, usage: { input_tokens: number; output_tokens: number } | undefined): AiUsage {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const price = PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK['claude-opus-5'];
  return {
    model,
    inputTokens: input,
    outputTokens: output,
    costUsd: Math.round(((input * price.input + output * price.output) / 1_000_000) * 10_000) / 10_000,
  };
}

function checkStop(stopReason: string | null, stopDetails?: { explanation?: string | null } | null): void {
  if (stopReason === 'refusal') throw new AiRefusalError(stopDetails?.explanation ?? null);
  if (stopReason === 'max_tokens') {
    throw new AiOutputError('The response was cut off before it finished. Try again with less input.');
  }
}

/**
 * One request, one schema-validated object back. Used for extraction,
 * drafting and analysis: the schema is enforced by the API, and parsed
 * again here, so callers get a typed value or an error, never half a JSON.
 */
export async function aiStructured<S extends z.ZodType>(opts: {
  system: string;
  content: string | Anthropic.Beta.BetaContentBlockParam[];
  schema: S;
  effort?: Effort;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; usage: AiUsage }> {
  const client = getClient();
  const response = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: opts.maxTokens ?? 16_000,
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort ?? 'medium', format: betaZodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: 'user', content: opts.content }],
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  });

  checkStop(response.stop_reason, response.stop_details);
  if (response.parsed_output == null) {
    throw new AiOutputError('The model returned something that did not match the expected format.');
  }
  return { data: response.parsed_output as z.infer<S>, usage: usageOf(response.model || AI_MODEL, response.usage) };
}

/**
 * Research with live web search, then report findings through a recording
 * tool whose input is validated against `schema`.
 *
 * Structured outputs can't be combined with web-search citations, so the
 * findings come back as the input to a client-side tool instead. The loop
 * resumes paused server-tool turns and nudges the model if it finishes
 * without recording anything.
 */
export async function aiResearch<S extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
  recordTool: { name: string; description: string };
  maxSearches?: number;
  effort?: Effort;
  maxRounds?: number;
}): Promise<{ data: z.infer<S>; usage: AiUsage; searches: number }> {
  const client = getClient();
  // Drop the draft marker: tool input schemas are plain JSON Schema objects.
  const { $schema: _draft, ...jsonSchema } = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  void _draft;
  const inputSchema = jsonSchema as Anthropic.Beta.BetaTool.InputSchema;

  const tools: Anthropic.Beta.BetaToolUnion[] = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: opts.maxSearches ?? 6 },
    { name: opts.recordTool.name, description: opts.recordTool.description, input_schema: inputSchema },
  ];

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: opts.prompt }];
  let inputTokens = 0;
  let outputTokens = 0;
  let searches = 0;
  let model = AI_MODEL;

  for (let round = 0; round < (opts.maxRounds ?? 5); round++) {
    const response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16_000,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.effort ?? 'medium' },
      system: opts.system,
      tools,
      tool_choice: { type: 'auto' },
      messages,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    });

    model = response.model || model;
    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    searches += response.content.filter((b) => b.type === 'server_tool_use').length;
    checkStop(response.stop_reason, response.stop_details);

    const record = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === opts.recordTool.name
    );
    if (record) {
      const parsed = opts.schema.safeParse(record.input);
      if (parsed.success) {
        const usage = usageOf(model, { input_tokens: inputTokens, output_tokens: outputTokens });
        // Searches are billed on top of tokens, at $10 per 1,000.
        usage.costUsd = Math.round((usage.costUsd + searches * SEARCH_PRICE_USD) * 10_000) / 10_000;
        return { data: parsed.data, usage, searches };
      }
      // Tell the model exactly what was wrong and let it try once more.
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: record.id,
            is_error: true,
            content: `The input did not match the schema: ${parsed.error.message.slice(0, 1500)}. Call ${opts.recordTool.name} again with corrected input.`,
          },
        ],
      });
      continue;
    }

    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'pause_turn') continue; // a long server-tool turn: resume it
    messages.push({
      role: 'user',
      content: `Now call ${opts.recordTool.name} with what you found. If you found nothing, call it with empty lists.`,
    });
  }

  throw new AiOutputError('The research did not finish with a result. Try again later.');
}

/** Maps the typed errors to an HTTP response shape for API routes. */
export function aiErrorResponse(e: unknown): { status: number; body: { error: string; code: string } } {
  if (e instanceof AiUnavailableError) return { status: 503, body: { error: e.message, code: 'ai_unavailable' } };
  if (e instanceof AiRefusalError) return { status: 422, body: { error: e.message, code: 'ai_refused' } };
  if (e instanceof AiOutputError) return { status: 502, body: { error: e.message, code: 'ai_output' } };
  if (e instanceof Anthropic.AuthenticationError) {
    return { status: 503, body: { error: 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.', code: 'ai_auth' } };
  }
  if (e instanceof Anthropic.RateLimitError) {
    return { status: 429, body: { error: 'The AI is rate limited right now. Try again in a minute.', code: 'ai_rate_limited' } };
  }
  if (e instanceof Anthropic.APIError) {
    return { status: 502, body: { error: `AI request failed (${e.status ?? 'network'}).`, code: 'ai_api' } };
  }
  return { status: 500, body: { error: e instanceof Error ? e.message : 'AI request failed', code: 'ai_unknown' } };
}
