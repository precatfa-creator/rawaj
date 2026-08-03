import type { ChatMessage, ChatResponse } from '@heyputer/puter.js';

/**
 * Building the messages sent to puter.ai.chat.
 *
 * Pure and dependency-free so chatMessages.check.ts can exercise it — the three
 * bugs this file exists to prevent all shipped a payload the API rejected, and
 * none of them was visible to the type checker.
 *
 * The history: the SDK types `images` as required on ChatMessage, so the code
 * sent `images: []`, and the API answered `Unknown parameter: 'input[0].images'`.
 * Removing that surfaced `Unknown parameter: 'input[5].reasoning'`, because the
 * assistant turn was echoed back verbatim and a reasoning model attaches its own
 * `reasoning` field to the response. Both were the same mistake: treating a
 * response message as if it were an input message.
 */

/**
 * What may appear on an input message, per docs.puter.com/AI/chat.
 *
 * `images` is deliberately absent even though the SDK's ChatMessage requires
 * it: this assistant is text in, text out, and the API rejects the field.
 */
export type OutgoingMessage = Omit<ChatMessage, 'images'>;

/** The SDK demands `images`; the API refuses it. Cast at the boundary once. */
export const asPayload = (messages: OutgoingMessage[]) => messages as ChatMessage[];

export const toChatMessage = (role: string, content: string): OutgoingMessage => ({
  role,
  content,
});

/** A tool result, which the docs define as exactly these three fields. */
export const toToolResult = (toolCallId: string, content: string): OutgoingMessage => ({
  role: 'tool',
  tool_call_id: toolCallId,
  content,
});

/**
 * Rebuilds an assistant turn from only the fields an input message may carry.
 *
 * Whitelisting rather than deleting known-bad keys is the point: a field a
 * future model invents cannot reach the wire, because nothing copies the
 * response wholesale any more.
 */
export const toOutgoing = (message: NonNullable<ChatResponse['message']>): OutgoingMessage => {
  const outgoing: OutgoingMessage = {
    role: message.role ?? 'assistant',
    content: message.content ?? '',
  };
  if (message.tool_calls?.length) outgoing.tool_calls = message.tool_calls;
  if (message.tool_call_id) outgoing.tool_call_id = message.tool_call_id;
  return outgoing;
};
