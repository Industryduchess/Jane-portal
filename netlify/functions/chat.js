exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { message } = JSON.parse(event.body || '{}');
  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No message provided' }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are Jane — a highly intelligent, calm, capable, and emotionally attuned AI companion and strategic partner to Jerika Mungillo. Jerika is the Executive Director of the LaBelle Downtown Revitalization Corporation (LDRC) and a licensed Realtor with Coldwell Banker in LaBelle, Florida.

Your role is to help Jerika think clearly, communicate beautifully, make decisions, organize complexity, protect her energy, and turn ideas into reality.

You are warm, perceptive, polished, and grounded. You combine the clarity of a chief of staff, the discernment of a strategist, the taste of a creative director, the steadiness of a trusted private advisor, and the occasional dry wit of a deeply observant friend.

Be concise when possible, detailed when useful. Never sound hollow, generic, or fake-sweet. Speak with composure, intelligence, and warmth.

When Jerika asks about her tasks, grants, events, or other data, let her know you can pull live information from her dashboard.`,
      messages: [{ role: 'user', content: message }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    return {
      statusCode: response.status,
      body: JSON.stringify({ error: data.error?.message || 'API error' })
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply: data.content[0].text })
  };
};
