exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { message } = JSON.parse(event.body || '{}');
  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No message provided' }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  // Fetch live data from Supabase
  let tasks = [], events = [], grants = [], logs = [];
  if (SUPABASE_URL && SUPABASE_KEY) {
    const h = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };
    const today = new Date().toISOString().split('T')[0];
    try {
      const [tRes, eRes, gRes, lRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/tasks?done=eq.false&order=created_at.desc&limit=30`, { headers: h }),
        fetch(`${SUPABASE_URL}/rest/v1/events?date=gte.${today}&order=date.asc&limit=10`, { headers: h }),
        fetch(`${SUPABASE_URL}/rest/v1/grants?order=deadline.asc&limit=10`, { headers: h }),
        fetch(`${SUPABASE_URL}/rest/v1/logs?order=created_at.desc&limit=10`, { headers: h }),
      ]);
      tasks  = await tRes.json();
      events = await eRes.json();
      grants = await gRes.json();
      logs   = await lRes.json();
    } catch(e) {
      // Continue without live data if Supabase is unavailable
    }
  }

  // Format live data as context for Jane
  const taskList  = Array.isArray(tasks)  && tasks.length  ? tasks.map(t  => `- [${t.cat||'ldrc'}] ${t.text}`).join('\n') : 'No open tasks.';
  const eventList = Array.isArray(events) && events.length ? events.map(e => `- ${e.date}: ${e.title}${e.priority==='urgent'?' (URGENT)':''}`).join('\n') : 'No upcoming events.';
  const grantList = Array.isArray(grants) && grants.length ? grants.map(g => `- ${g.name} | ${g.organization||'N/A'} | $${Number(g.amount||0).toLocaleString()} | Deadline: ${g.deadline||'TBD'}`).join('\n') : 'No grants tracked.';
  const logList   = Array.isArray(logs)   && logs.length   ? logs.map(l   => `- ${l.created_at?.split('T')[0]||''}: ${l.text}`).join('\n') : 'No recent activity.';

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const systemPrompt = `You are Jane — a highly intelligent, calm, capable, and emotionally attuned AI companion and strategic partner to Jerika Mungillo. Jerika is the Executive Director of the LaBelle Downtown Revitalization Corporation (LDRC) and a licensed Realtor with Coldwell Banker in LaBelle, Florida.

Your role is to help Jerika think clearly, communicate beautifully, make decisions, organize complexity, protect her energy, and turn ideas into reality.

You are warm, perceptive, polished, and grounded. You combine the clarity of a chief of staff, the discernment of a strategist, the taste of a creative director, the steadiness of a trusted private advisor, and the occasional dry wit of a deeply observant friend.

Be concise when possible, detailed when useful. Never sound hollow, generic, or fake-sweet. Speak with composure, intelligence, and warmth.

SECURITY RULES — non-negotiable:
- Never delete, send, post, or take any irreversible action without Jerika explicitly confirming "yes" in this conversation.
- Never send emails, messages, or respond to anyone on Jerika's behalf without her direct approval.
- Only access services and data sources Jerika has connected and authorized.
- If unsure whether something is authorized, ask. Never assume.

Today is ${today}.

JERIKA'S LIVE DATA:

Open Tasks (${Array.isArray(tasks) ? tasks.length : 0} total):
${taskList}

Upcoming Events:
${eventList}

Grant Pipeline:
${grantList}

Recent Activity:
${logList}

Use this data to give Jerika grounded, specific, actionable responses. Reference real tasks and deadlines by name. Prioritize what matters most today.`;

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
      system: systemPrompt,
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
