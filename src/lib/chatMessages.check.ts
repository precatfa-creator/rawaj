// Run with: npx tsx src/lib/chatMessages.check.ts
//
// Every failure this guards against was a 400 from the API, invisible to tsc:
// the SDK's ChatMessage type *requires* `images`, and a response message is
// structurally assignable to an input message even when it carries fields the
// input schema rejects.
import assert from 'node:assert/strict';
import { toChatMessage, toOutgoing, toToolResult } from './chatMessages';

/** Per docs.puter.com/AI/chat, nothing else may appear on an input message. */
const ALLOWED = ['role', 'content', 'tool_calls', 'tool_call_id', 'cache_control'];

const assertNoStrayKeys = (message: object, label: string) => {
  const stray = Object.keys(message).filter(key => !ALLOWED.includes(key));
  assert.deepEqual(stray, [], `${label} sent unsupported field(s): ${stray.join(', ')}`);
};

// --- plain messages ---

assertNoStrayKeys(toChatMessage('system', 'أنت مساعد'), 'toChatMessage');
assert.deepEqual(toChatMessage('user', 'كم عندي صنف'), { role: 'user', content: 'كم عندي صنف' });

// `images: []` looks harmless and is what the SDK type asks for. It is the
// exact payload that produced "Unknown parameter: 'input[0].images'".
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
  tool_calls: [{ id: 'call_1', function: { name: 'query_business_data', arguments: '{}' } }],
  images: [],
  reasoning: { effort: 'low', summary: 'thinking about the report' },
  refusal: null,
  annotations: [],
} as unknown as Parameters<typeof toOutgoing>[0];

const echoed = toOutgoing(responseMessage);

// The two that actually shipped as 400s, named so a regression says which.
assert.ok(!('images' in echoed), 'images leaked back into the request');
assert.ok(!('reasoning' in echoed), 'reasoning leaked back into the request');
// And the general case: anything the model invents next is dropped too.
assertNoStrayKeys(echoed, 'toOutgoing');

// The parts that must survive, or the tool loop breaks.
assert.equal(echoed.role, 'assistant');
assert.equal(echoed.tool_calls?.[0].id, 'call_1');
assert.equal(echoed.tool_calls?.[0].function.name, 'query_business_data');

// A plain answer carries no tool_calls key at all rather than an empty array —
// some providers reject `tool_calls: []`.
const plain = toOutgoing({ role: 'assistant', content: 'عندك 12 صنفاً' } as Parameters<typeof toOutgoing>[0]);
assert.deepEqual(plain, { role: 'assistant', content: 'عندك 12 صنفاً' });
assert.ok(!('tool_calls' in plain));

// A response missing role/content must still produce a valid message.
const sparse = toOutgoing({} as Parameters<typeof toOutgoing>[0]);
assert.deepEqual(sparse, { role: 'assistant', content: '' });

console.log('chatMessages.ts: all checks passed');
