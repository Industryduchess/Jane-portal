exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_URL       = process.env.SUPABASE_URL;
  const SUPABASE_KEY       = process.env.SUPABASE_ANON_KEY;
  const GOOGLE_CLIENT_ID   = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
  const DRIVE_FOLDER_ID    = process.env.GOOGLE_DRIVE_FOLDER_ID || '114GgytSLDuiJ6NSqsJRNhr41x4dh2WY2';

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) }; }

  const { fileData, fileName, fileType, platform = 'Facebook', additionalContext = '' } = body;
  if (!fileData || !fileName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'File data and filename required' }) };
  }

  const sbHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // ── Step 1: Refresh Google Access Token ──────────────────────────────────
  let accessToken = null;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: GOOGLE_REFRESH_TOKEN,
          grant_type: 'refresh_token'
        }).toString()
      });
      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;
    } catch (e) {
      console.error('Google token refresh failed:', e.message);
    }
  }

  // ── Step 2: Find or Create Month Subfolder in Drive ──────────────────────
  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); // "April 2026"
  let targetFolderId = DRIVE_FOLDER_ID;
  let driveFileId = null;
  let driveUrl = null;

  if (accessToken) {
    try {
      const q = encodeURIComponent(
        `name='${monthLabel}' and '${DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      );
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const searchData = await searchRes.json();

      if (searchData.files && searchData.files.length > 0) {
        targetFolderId = searchData.files[0].id;
      } else {
        // Create the month subfolder
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: monthLabel,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [DRIVE_FOLDER_ID]
          })
        });
        const createData = await createRes.json();
        targetFolderId = createData.id || DRIVE_FOLDER_ID;
      }
    } catch (e) {
      console.error('Drive folder lookup failed:', e.message);
    }

    // ── Step 3: Upload File to Drive (multipart) ──────────────────────────
    try {
      const boundary = 'ldrc_boundary_' + Date.now();
      const metadata = JSON.stringify({ name: fileName, parents: [targetFolderId] });

      const multipartBody = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        metadata,
        `--${boundary}`,
        `Content-Type: ${fileType}`,
        'Content-Transfer-Encoding: base64',
        '',
        fileData,
        `--${boundary}--`
      ].join('\r\n');

      const uploadRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body: multipartBody
        }
      );
      const uploadData = await uploadRes.json();
      driveFileId = uploadData.id;
      driveUrl = uploadData.webViewLink;
    } catch (e) {
      console.error('Drive upload failed:', e.message);
    }
  }

  // ── Step 4: Use Claude Vision to Read the Flyer ──────────────────────────
  const isImage = (fileType || '').startsWith('image/');
  let extractedText = '';
  let postData = null;

  if (isImage && ANTHROPIC_API_KEY) {
    try {
      // First pass: extract details from the flyer
      const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: fileType, data: fileData }
              },
              {
                type: 'text',
                text: 'This is a flyer for an event or announcement. Extract all key details: event name, date, time, location, description, any special notes. Be concise and factual. Return plain text only.'
              }
            ]
          }]
        })
      });
      const extractData = await extractRes.json();
      extractedText = extractData.content?.[0]?.text?.trim() || '';
    } catch (e) {
      console.error('Vision extraction failed:', e.message);
    }
  }

  // ── Step 5: Generate the Social Post ────────────────────────────────────
  if (ANTHROPIC_API_KEY) {
    const PLATFORM_SPECS = {
      'Facebook':  { max_chars: 500, style: 'Conversational, community-first. Ask questions to spark engagement.', hashtag_count: '3–5' },
      'Instagram': { max_chars: 300, style: 'Visually descriptive, emoji-friendly, aspirational.', hashtag_count: '10–15' },
      'Twitter/X': { max_chars: 280, style: 'Punchy, concise, with a clear CTA or hook.', hashtag_count: '2–3' },
      'LinkedIn':  { max_chars: 600, style: 'Professional yet warm. Highlight economic impact and partnerships.', hashtag_count: '3–5' }
    };
    const spec = PLATFORM_SPECS[platform] || PLATFORM_SPECS['Facebook'];

    const scheduleMap = {
      'Facebook':  { day: 'Tuesday',   time: '10:00 AM ET' },
      'Instagram': { day: 'Wednesday', time: '12:00 PM ET' },
      'Twitter/X': { day: 'Thursday',  time: '9:00 AM ET'  },
      'LinkedIn':  { day: 'Friday',    time: '11:00 AM ET' }
    };
    const sched = scheduleMap[platform] || scheduleMap['Facebook'];

    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const now = new Date();
    const delta = (days.indexOf(sched.day) - now.getDay() + 7) % 7 || 7;
    const scheduledDate = new Date(now);
    scheduledDate.setDate(now.getDate() + delta);
    const scheduledDateStr = scheduledDate.toISOString().split('T')[0];

    const topic = extractedText || 'Community announcement';
    const today = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const prompt = `You are a social media writer for the LaBelle Downtown Revitalization Corporation (LDRC) in LaBelle, Florida.

BRAND VOICE: Warm, community-focused, optimistic, authentic — speak like a neighbor, not a press release.
AVOID: Corporate jargon, negativity, divisive or political topics.
ALWAYS INCLUDE: #LaBelle #LaBelleFL #DowntownLaBelle #LDRC

PLATFORM: ${platform}
Style: ${spec.style}
Max characters (body only): ${spec.max_chars}
Hashtag count: ${spec.hashtag_count}
TODAY: ${today}

FLYER DETAILS (extracted by AI):
${topic}
${additionalContext ? `\nADDITIONAL NOTES FROM JERIKA:\n${additionalContext}` : ''}

Write a single polished, ready-to-publish social media post. Return ONLY a JSON object:
{
  "platform": "${platform}",
  "post_copy": "...",
  "hashtags": "...",
  "image_prompt": "Describe the uploaded flyer as the image to use with this post",
  "theme": "...",
  "call_to_action": "...",
  "scheduled_day": "${sched.day}",
  "scheduled_time": "${sched.time}",
  "scheduled_date": "${scheduledDateStr}",
  "type": "Flyer Post",
  "status": "Pending Review"
}`;

    try {
      const messages = isImage ? [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: fileType, data: fileData } },
          { type: 'text', text: prompt }
        ]
      }] : [{ role: 'user', content: prompt }];

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages })
      });
      const aiData = await aiRes.json();
      let raw = aiData.content?.[0]?.text?.trim() || '{}';
      if (raw.startsWith('```')) { raw = raw.split('```')[1]; if (raw.startsWith('json')) raw = raw.slice(4); }
      postData = JSON.parse(raw.trim());
    } catch (e) {
      console.error('Post generation failed:', e.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to generate post from flyer' }) };
    }
  }

  // ── Step 6: Save Post + Asset to Supabase ────────────────────────────────
  let savedPostId = null;
  if (SUPABASE_URL && SUPABASE_KEY && postData) {
    try {
      const postRes = await fetch(`${SUPABASE_URL}/rest/v1/social_posts`, {
        method: 'POST', headers: sbHeaders, body: JSON.stringify(postData)
      });
      const savedPost = await postRes.json();
      if (Array.isArray(savedPost) && savedPost[0]) {
        savedPostId = savedPost[0].id;
        postData.id = savedPostId;
        postData.created_at = savedPost[0].created_at;
      }
    } catch (e) { console.error('Supabase post save failed:', e.message); }

    // Save media asset record
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/media_assets`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          filename: fileName,
          file_type: fileType,
          drive_file_id: driveFileId,
          drive_url: driveUrl,
          drive_folder_id: targetFolderId,
          month_label: monthLabel,
          extracted_text: extractedText,
          post_id: savedPostId
        })
      });
    } catch (e) { console.error('Supabase asset save failed:', e.message); }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post: postData,
      asset: { driveFileId, driveUrl, monthLabel, extractedText }
    })
  };
};
