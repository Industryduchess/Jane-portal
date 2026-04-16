exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { topic, platform, additionalContext } = JSON.parse(event.body || '{}');
  if (!topic || !platform) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Topic and platform are required' }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  // ── LDRC Brand Guidelines ────────────────────────────────────────────────
  const PLATFORM_SPECS = {
    'Facebook':   { max_chars: 500,  style: 'Conversational, community-first. Ask questions to spark engagement.', hashtag_count: '3–5' },
    'Instagram':  { max_chars: 300,  style: 'Visually descriptive, emoji-friendly, aspirational.', hashtag_count: '10–15' },
    'Twitter/X':  { max_chars: 280,  style: 'Punchy, concise, with a clear CTA or hook.', hashtag_count: '2–3' },
    'LinkedIn':   { max_chars: 600,  style: 'Professional yet warm. Highlight economic impact and partnerships.', hashtag_count: '3–5' },
  };

  const spec = PLATFORM_SPECS[platform] || PLATFORM_SPECS['Facebook'];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Figure out next logical posting date for this platform
  const scheduleMap = {
    'Facebook':  { day: 'Tuesday',  time: '10:00 AM ET' },
    'Instagram': { day: 'Wednesday',time: '12:00 PM ET' },
    'Twitter/X': { day: 'Thursday', time: '9:00 AM ET'  },
    'LinkedIn':  { day: 'Friday',   time: '11:00 AM ET' },
  };
  const sched = scheduleMap[platform] || { day: 'Tuesday', time: '10:00 AM ET' };

  // Calculate next occurrence of the scheduled day
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const now = new Date();
  const targetDay = days.indexOf(sched.day);
  const currentDay = now.getDay();
  let delta = (targetDay - currentDay + 7) % 7 || 7;
  const scheduledDate = new Date(now);
  scheduledDate.setDate(now.getDate() + delta);
  const scheduledDateStr = scheduledDate.toISOString().split('T')[0];

  const prompt = `You are a social media writer for the LaBelle Downtown Revitalization Corporation (LDRC) in LaBelle, Florida.

MISSION: Revitalizing downtown LaBelle by supporting local businesses, celebrating community culture, and driving economic growth.

BRAND VOICE:
- Warm and community-focused
- Optimistic and action-oriented
- Authentic — speak like a neighbor, not a press release
- Inclusive and welcoming to all residents and visitors

AVOID:
- Corporate jargon or overly formal language
- Negativity or divisive topics
- National political topics

ALWAYS INCLUDE THESE HASHTAGS: #LaBelle #LaBelleFL #DowntownLaBelle #LDRC

PLATFORM: ${platform}
Platform style: ${spec.style}
Max characters (body only, not hashtags): ${spec.max_chars}
Hashtag count target: ${spec.hashtag_count}

TODAY: ${today}

TOPIC TO WRITE ABOUT:
${topic}
${additionalContext ? `\nADDITIONAL CONTEXT:\n${additionalContext}` : ''}

Write a single polished, ready-to-publish social media post. Return ONLY a JSON object with these exact keys:
{
  "platform": "${platform}",
  "post_copy": "...",
  "hashtags": "...",
  "image_prompt": "A detailed Midjourney/DALL-E style prompt describing the ideal image for this post",
  "theme": "...",
  "call_to_action": "...",
  "scheduled_day": "${sched.day}",
  "scheduled_time": "${sched.time}",
  "scheduled_date": "${scheduledDateStr}",
  "type": "On-Demand Post",
  "status": "Pending Review"
}`;

  try {
    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await aiResponse.json();
    if (!aiResponse.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: aiData.error?.message || 'AI error' }) };
    }

    // Parse the JSON post from Claude's response
    let raw = aiData.content[0].text.trim();
    if (raw.startsWith('```')) {
      raw = raw.split('```')[1];
      if (raw.startsWith('json')) raw = raw.slice(4);
    }
    const postData = JSON.parse(raw.trim());

    // Save to Supabase if credentials are available
    if (SUPABASE_URL && SUPABASE_KEY) {
      const sbHeaders = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      };
      const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/social_posts`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify(postData)
      });
      const saved = await sbRes.json();
      if (Array.isArray(saved) && saved[0]) {
        postData.id = saved[0].id;
        postData.created_at = saved[0].created_at;
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post: postData })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Something went wrong' })
    };
  }
};
