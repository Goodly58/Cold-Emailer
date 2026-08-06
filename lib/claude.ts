/**
 * The Claude client.
 *
 * Every call in this product runs under the evidence contract: facts come only
 * from evidence rows or confirmed profile fields, never from the model's own
 * knowledge. That contract is enforced per call site; this module only handles
 * the connection, and gives every caller a way to degrade politely when the
 * API is unavailable — a missing API key must never be a dead end the user
 * cannot get past.
 */
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL = 'claude-opus-5';

let client: Anthropic | null = null;

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface AskOptions {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Low for short, scoped calls; the interview follow-up does not need depth. */
  effort?: 'low' | 'medium' | 'high';
}

/**
 * One text completion. Returns null rather than throwing when Claude is
 * unavailable, so every caller has to decide what the user sees when this goes
 * wrong — which is the point of the POV directive's third persona.
 */
export async function askClaude(options: AskOptions): Promise<string | null> {
  if (!isClaudeConfigured()) return null;

  try {
    const response = await getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: options.maxTokens ?? 1024,
      system: options.system,
      thinking: { type: 'adaptive' },
      output_config: { effort: options.effort ?? 'low' },
      messages: [{ role: 'user', content: options.prompt }],
    });

    if (response.stop_reason === 'refusal') return null;

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    return text.length > 0 ? text : null;
  } catch (e) {
    console.error('[claude] request failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
