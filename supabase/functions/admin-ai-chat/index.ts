import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const DATABASE_TOOL = {
  type: 'function',
  function: {
    name: 'query_business_data',
    description:
      'Read a safe, aggregate report from the live Rawaj database. Use this before making any claim about business data. It never returns contact details, addresses, notes, credentials, or arbitrary SQL results.',
    parameters: {
      type: 'object',
      properties: {
        report: {
          type: 'string',
          enum: [
            'overview', 'monthly_sales', 'order_statuses', 'top_products', 'top_customers',
            'top_cities', 'low_stock', 'stock_activity', 'recent_orders',
          ],
          description: 'The report to retrieve.',
        },
        store_id: {
          type: ['string', 'null'],
          description: 'Exact store ID from the supplied store list, or null for all stores.',
        },
        limit: {
          type: 'integer', minimum: 1, maximum: 20,
          description: 'Maximum rows for ranked and recent reports. Defaults to 10.',
        },
        months: {
          type: 'integer', minimum: 1, maximum: 12,
          description: 'Number of months for monthly_sales. Defaults to 6.',
        },
      },
      required: ['report'],
      additionalProperties: false,
    },
  },
};

type InputMessage = {
  role?: unknown;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
};

const cleanToolCalls = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  const calls = value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const call = item as Record<string, unknown>;
    const fn = call.function;
    if (!fn || typeof fn !== 'object') return [];
    const functionCall = fn as Record<string, unknown>;
    if (typeof call.id !== 'string' || typeof functionCall.name !== 'string'
      || typeof functionCall.arguments !== 'string') return [];
    return [{
      id: call.id.slice(0, 200),
      type: 'function',
      function: {
        name: functionCall.name.slice(0, 100),
        arguments: functionCall.arguments.slice(0, 20_000),
      },
    }];
  });
  return calls.length > 0 ? calls : undefined;
};

const cleanMessages = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return null;
  let totalLength = 0;
  const messages = value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const message = item as InputMessage;
    const role = typeof message.role === 'string' ? message.role : '';
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) return [];
    const content = typeof message.content === 'string' ? message.content : '';
    totalLength += content.length;
    const cleaned: Record<string, unknown> = { role, content };
    const toolCalls = cleanToolCalls(message.tool_calls);
    if (toolCalls) cleaned.tool_calls = toolCalls;
    if (typeof message.tool_call_id === 'string') {
      cleaned.tool_call_id = message.tool_call_id.slice(0, 200);
    }
    return [cleaned];
  });
  return messages.length === value.length && totalLength <= 160_000 ? messages : null;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const zaiApiKey = Deno.env.get('ZAI_API_KEY');
  const authorization = request.headers.get('Authorization');

  if (!supabaseUrl || !anonKey || !zaiApiKey || !authorization) {
    return json({ error: 'Server is not configured' }, 500);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);

  const { data: callerProfile, error: profileError } = await callerClient
    .from('profiles')
    .select('role,active')
    .eq('id', userData.user.id)
    .single();
  if (profileError || callerProfile?.role !== 'admin' || !callerProfile.active) {
    return json({ error: 'Admin access required' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const messages = cleanMessages(body.messages);
  if (!messages) return json({ error: 'Invalid messages' }, 400);

  const providerBody = JSON.stringify({
    model: 'glm-4.7-flash',
    messages,
    max_tokens: 4000,
    temperature: 0.2,
    stream: false,
    ...(body.use_tools === true ? { tools: [DATABASE_TOOL], tool_choice: 'auto' } : {}),
  });

  let upstream: Response | null = null;
  let result: unknown = null;
  // Flash is a free shared-capacity model and may answer with provider code
  // 1305 while busy. Those responses arrive immediately, so a short bounded
  // retry is both faster for the user and safer than retrying in the browser,
  // where a double click could start two independent tool loops.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      upstream = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${zaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: providerBody,
        signal: AbortSignal.timeout(60_000),
      });
      result = await upstream.json().catch(() => null);
    } catch (error) {
      console.error('Z.AI request failed', error);
      if (attempt === 2) return json({ error: 'AI provider is unavailable' }, 502);
      await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
      continue;
    }

    const providerError = result && typeof result === 'object' && 'error' in result
      ? (result as { error?: unknown }).error
      : null;
    const detail = providerError && typeof providerError === 'object'
      ? providerError as Record<string, unknown>
      : {};
    const providerCode = typeof detail.code === 'string' ? detail.code : '';
    const retryable = providerCode === '1305' || upstream.status === 429 || upstream.status >= 500;
    if (!upstream.ok && retryable && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
      continue;
    }
    break;
  }

  if (!upstream?.ok) {
    console.error('Z.AI rejected the request', upstream?.status, result);
    const providerError = result && typeof result === 'object' && 'error' in result
      ? (result as { error?: unknown }).error
      : null;
    const detail = providerError && typeof providerError === 'object'
      ? providerError as Record<string, unknown>
      : {};
    return json({
      error: 'AI provider rejected the request',
      provider_code: typeof detail.code === 'string' ? detail.code : undefined,
      provider_message: typeof detail.message === 'string' ? detail.message.slice(0, 500) : undefined,
    }, 502);
  }
  if (!result || !Array.isArray(result.choices)) {
    return json({ error: 'AI provider returned an invalid response' }, 502);
  }

  return json(result);
});
