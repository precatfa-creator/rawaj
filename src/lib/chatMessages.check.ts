// Run with: npx tsx src/lib/chatMessages.check.ts
//
// Response messages are structurally assignable to input messages even when
// they carry provider-only fields the next request rejects.
import assert from 'node:assert/strict';
import { toChatMessage, toOutgoing, toToolResult } from './chatMessages';

const ALLOWED = ['role', 'content', 'tool_calls', 'tool_call_id'];

const assertNoStrayKeys = (message: object, label: string) => {
  const stray = Object.keys(message).filter(key => !ALLOWED.includes(key));
  assert.deepEqual(stray, [], `${label} sent unsupported field(s): ${stray.join(', ')}`);
};

// --- plain messages ---

assertNoStrayKeys(toChatMessage('system', 'أنت مساعد'), 'toChatMessage');
assert.deepEqual(toChatMessage('user', 'كم عندي صنف'), { role: 'user', content: 'كم عندي صنف' });

assert.ok(!('images' in toChatMessage('user', 'x')), 'images must never be sent');

// --- tool results ---

const toolResult = toToolResult('call_abc', '{"rows":[]}');
assertNoStrayKeys(toolResult, 'toToolResult');
assert.deepEqual(toolResult, { role: 'tool', tool_call_id: 'call_abc', content: '{"rows":[]}' });

// --- echoing an assistant turn back ---

// A reasoning model's response, carrying fields the input schema rejects.
const responseMessage = {
  role: 'assistant',
  content: '',
  tool_calls: [{
    id: 'call_1',
    type: 'function',
    function: { name: 'query_business_data', arguments: '{}' },
    provider_only: true,
  }],
  images: [],
  reasoning_content: 'thinking about the report',
  refusal: null,
  annotations: [],
} as unknown as Parameters<typeof toOutgoing>[0];

const echoed = toOutgoing(responseMessage);

// The two that actually shipped as 400s, named so a regression says which.
assert.ok(!('images' in echoed), 'images leaked back into the request');
assert.ok(!('reasoning_content' in echoed), 'reasoning leaked back into the request');
// And the general case: anything the model invents next is dropped too.
assertNoStrayKeys(echoed, 'toOutgoing');

// The parts that must survive, or the tool loop breaks.
assert.equal(echoed.role, 'assistant');
assert.equal(echoed.tool_calls?.[0].id, 'call_1');
assert.equal(echoed.tool_calls?.[0].function.name, 'query_business_data');
assert.ok(!('provider_only' in (echoed.tool_calls?.[0] ?? {})), 'tool-call metadata leaked into the request');

// A plain answer carries no tool_calls key at all rather than an empty array —
// some providers reject `tool_calls: []`.
const plain = toOutgoing({ role: 'assistant', content: 'عندك 12 صنفاً' } as Parameters<typeof toOutgoing>[0]);
assert.deepEqual(plain, { role: 'assistant', content: 'عندك 12 صنفاً' });
assert.ok(!('tool_calls' in plain));

// A response missing role/content must still produce a valid message.
const sparse = toOutgoing({} as Parameters<typeof toOutgoing>[0]);
assert.deepEqual(sparse, { role: 'assistant', content: '' });

console.log('chatMessages.ts: all checks passed');
