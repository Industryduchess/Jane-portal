/**
 * create-canva-flyer.js
 * Creates a Canva flyer design pre-populated with LDRC post details.
 *
 * Required env var (optional — fallback opens Canva templates):
 *   CANVA_API_TOKEN  — Canva Connect API access token
 *
 * LDRC brand kit ID: kADdWW2cd_4
 */
exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { postId, postData } = body;
  const CANVA_TOKEN     = process.env.CANVA_API_TOKEN;
  const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
  const BRAND_KIT_ID    = 'kADdWW2cd_4'; // LDRC brand kit

  const p = postData || {};

  // ── Build a descriptive design title ────────────────────────────────────
  const title = [p.theme, p.call_to_action]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 120) || 'LDRC Community Post';

  // ── Generate a rich design brief with Claude ─────────────────────────────
  let designBrief = buildFallbackBrief(p);
  if (ANTHROPIC_KEY) {
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages: [{
            role: 'user',
            content: `You are a graphic design assistant for the LaBelle Downtown Revitalization Corporation (LDRC) in LaBelle, Florida.

Given this social media post, write a brief (3–5 sentences) design brief for a Canva flyer. Focus on:
- Key text to display prominently (event name, date, location, CTA)
- Color mood (LDRC palette: forest green + warm gold on cream)
- Overall feel (warm, community-focused, cheerful)

POST COPY: ${p.post_copy || ''}
THEME: ${p.theme || ''}
CTA: ${p.call_to_action || ''}
SCHEDULED: ${p.scheduled_date || ''}

Return only the design brief text, no JSON.`
          }]
        })
      });
      const aiData = await aiRes.json();
      if (aiData.content?.[0]?.text) {
        designBrief = aiData.content[0].text.trim();
      }
    } catch (e) {
      console.error('Brief generation failed:', e.message);
    }
  }

  // ── Attempt Canva API design creation ───────────────────────────────────
  let canvaUrl   = null;
  let designId   = null;
  let hasToken   = false;

  if (CANVA_TOKEN) {
    hasToken = true;
    try {
      const createRes = await fetch('https://api.canva.com/rest/v1/designs', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CANVA_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          design_type: { type: 'preset', name: 'FLYER_PORTRAIT' },
          title: title
        })
      });

      if (createRes.ok) {
        const createData = await createRes.json();
        designId  = createData.design?.id;
        canvaUrl  = createData.design?.urls?.edit_url;
        console.log('Canva design created:', designId);
      } else {
        const errData = await createRes.json().catch(() => ({}));
        console.error('Canva API error:', createRes.status, JSON.stringify(errData));
      }
    } catch (e) {
      console.error('Canva API request failed:', e.message);
    }
  }

  // ── Fallback: Canva flyer template page ─────────────────────────────────
  if (!canvaUrl) {
    canvaUrl = 'https://www.canva.com/create/flyers/';
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      canvaUrl,
      designId,
      hasToken,
      title,
      designBrief,
      brandKitId: BRAND_KIT_ID,
      // Formatted post content for clipboard fallback
      clipboardContent: buildFallbackBrief(p)
    })
  };
};

function buildFallbackBrief(p) {
  return [
    p.post_copy      ? p.post_copy                        : '',
    p.hashtags       ? p.hashtags                         : '',
    p.call_to_action ? `\nCall to action: ${p.call_to_action}` : '',
    p.theme          ? `Theme: ${p.theme}`                : '',
    p.scheduled_date ? `Scheduled: ${p.scheduled_date}`   : ''
  ].filter(Boolean).join('\n');
}
