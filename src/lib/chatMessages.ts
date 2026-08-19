/** OpenAI-compatible message shapes used by Z.AI's chat completions API. */
export interface ChatToolCall {
  id: string;
  type?: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChatMessage;
  }>;
}

/**
 * Building the messages sent to the protected Z.AI proxy.
 *
 * Pure and dependency-free so chatMessages.check.ts can ensure a provider's
 * response-only metadata never leaks back into a later request.
 */
export type OutgoingMessage = ChatMessage;

export const toChatMessage = (role: string, content: string): OutgoingMessage => ({
  role,
  content,
});

/** A tool result, which the OpenAI-compatible schema defines as these fields. */
export const toToolResult = (toolCallId: string, content: string): OutgoingMessage => ({
  role: 'tool',
  tool_call_id: toolCallId,
  content,
});

/**
 * Rebuilds an assistant turn from only fields accepted on input. GLM responses
 * may carry reasoning_content and future provider metadata; none reaches the
 * next request because both the message and every tool call are whitelisted.
 */
export const toOutgoing = (message: ChatMessage): OutgoingMessage => {
  const outgoing: OutgoingMessage = {
    role: message.role ?? 'assistant',
    content: message.content ?? '',
  };
  if (message.tool_calls?.length) {
    outgoing.tool_calls = message.tool_calls.map(call => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.function.name,
        arguments: call.function.arguments,
      },
    }));
  }
  if (message.tool_call_id) outgoing.tool_call_id = message.tool_call_id;
  return outgoing;
};
