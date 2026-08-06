/**
 * RFC822 message construction.
 *
 * Two things here are load-bearing:
 *
 * 1. THREADING. Sending with only Gmail's `threadId` threads the message in the
 *    *sender's* mailbox. The recipient's client threads by headers, so without
 *    `In-Reply-To` and the full `References` chain, follow-up 1 arrives as an
 *    orphan cold email that says "following up on my note" about a note that,
 *    as far as their client is concerned, never existed.
 *
 * 2. NO ATTACHMENT PATH. There is deliberately no way to attach a file to a
 *    cold-sequence message. A CV PDF is a top gateway-quarantine trigger, and
 *    the breakup email is the last shot. Attachments exist only in reply-assist,
 *    which is a warm thread and a different builder.
 */
import { randomUUID } from 'node:crypto';

export interface MessageParts {
  fromName: string;
  fromEmail: string;
  toName: string | null;
  toEmail: string;
  subject: string;
  body: string;
  /** Ours, generated before the send call so a crash is recoverable. */
  messageId: string;
  /** Set on every follow-up. Absent on a first touch. */
  inReplyTo?: string | null;
  references?: string[];
}

/** Our own Message-ID. Persisted before the Gmail call, never after. */
export function newMessageId(domain = 'outreach.local'): string {
  return `<${Date.now().toString(36)}.${randomUUID()}@${domain}>`;
}

/**
 * Encodes a header value.
 *
 * A display name like "Mohammed Al Shamsi" is fine as ASCII; anything outside
 * it needs RFC 2047, or the recipient sees mojibake in the from-line — which
 * for a name is worse than plain.
 */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function formatAddress(name: string | null, email: string): string {
  if (!name?.trim()) return email;
  const encoded = encodeHeader(name.trim());
  return /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/"/g, '')}" <${email}>` : `${encoded} <${email}>`;
}

/**
 * Plain text only, quoted-printable-free, one part.
 *
 * Plain text with no HTML alternative is itself a deliverability decision: it
 * is what a person actually typing an email produces, and it gives a filter
 * nothing to score.
 */
export function buildMime(parts: MessageParts): string {
  const headers: string[] = [
    `From: ${formatAddress(parts.fromName, parts.fromEmail)}`,
    `To: ${formatAddress(parts.toName, parts.toEmail)}`,
    `Subject: ${encodeHeader(parts.subject)}`,
    `Message-ID: ${parts.messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];

  if (parts.inReplyTo) headers.push(`In-Reply-To: ${parts.inReplyTo}`);
  if (parts.references && parts.references.length > 0) {
    // The full chain, oldest first. A truncated chain breaks threading in
    // exactly the clients most likely to be reading this.
    headers.push(`References: ${parts.references.join(' ')}`);
  }

  const body = parts.body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}

export interface Attachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/**
 * A reply, optionally carrying one attachment.
 *
 * Deliberately a separate function from `buildMime`, which has no attachment
 * path at all. The distinction is not stylistic: a CV attached to a *cold*
 * email is a top gateway-quarantine trigger and the message is never seen. A CV
 * attached to a reply to "please send your CV" is the entire point of the
 * email. Keeping them as two builders means the cold path cannot grow an
 * attachment by accident, however a future caller is written.
 *
 * One attachment, never more, and only ever the user's own approved CV.
 */
export function buildReplyMime(parts: MessageParts & { attachment?: Attachment | null }): string {
  if (!parts.attachment) return buildMime(parts);

  const boundary = `b_${randomUUID().replace(/-/g, '')}`;
  const headers: string[] = [
    `From: ${formatAddress(parts.fromName, parts.fromEmail)}`,
    `To: ${formatAddress(parts.toName, parts.toEmail)}`,
    `Subject: ${encodeHeader(parts.subject)}`,
    `Message-ID: ${parts.messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  if (parts.inReplyTo) headers.push(`In-Reply-To: ${parts.inReplyTo}`);
  if (parts.references && parts.references.length > 0) {
    headers.push(`References: ${parts.references.join(' ')}`);
  }

  const body = parts.body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  // 76 characters is the RFC 2045 line limit. Some gateways reject longer
  // lines outright, and a rejected CV is indistinguishable from being ignored.
  const encoded = parts.attachment.content.toString('base64').replace(/(.{76})/g, '$1\r\n');

  return [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
    '',
    `--${boundary}`,
    `Content-Type: ${parts.attachment.mimeType}; name="${parts.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${parts.attachment.filename}"`,
    '',
    encoded,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Gmail's `raw` field is base64url with no padding. */
export function toGmailRaw(mime: string): string {
  return Buffer.from(mime, 'utf8').toString('base64url');
}

/**
 * The subject a follow-up carries.
 *
 * `Re: ` plus the original verbatim — not a rewrite, not a re-subject. Clients
 * that thread by subject need the exact string, and the recipient needs to see
 * the thread they already ignored rather than a new one.
 */
export function replySubject(originalSubject: string): string {
  return /^re:\s*/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;
}

/**
 * Appends the signature block, which sits outside the word budget.
 *
 * The Gmail API does not apply the account's signature, so a message sent
 * through it arrives without the sign-off the user sees on everything else they
 * send. Wamda's guidance is specific about why it matters in the region: names
 * repeat, and a signature is how a recipient works out who wrote to them.
 */
export function withSignature(body: string, signature: string | null, fallbackName?: string | null): string {
  if (signature?.trim()) return `${body.trimEnd()}\n${signature.trim()}\n`;

  // No Gmail signature is the common case for a student's personal account, and
  // the generated body ends at "Kind regards," on purpose — the sign-off is
  // supplied here. Without either, the email arrives signed off by nobody,
  // which in a market where names repeat is precisely the thing Wamda's
  // guidance says makes a recipient unable to place who wrote to them.
  if (fallbackName?.trim()) return `${body.trimEnd()}\n${fallbackName.trim()}\n`;
  return body;
}
