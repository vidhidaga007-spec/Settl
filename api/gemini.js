// api/gemini.js
// This is a Vercel serverless function.
// It runs on Vercel's servers — NOT in the browser.
// Your API key stays secret here and is never exposed to users.

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Get API key from Vercel environment variable (never exposed to browser)
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured on server.' })
  }

  try {
    const { type, text, audioBase64 } = req.body

    let parts = []

    // ── TEXT MODE: parse a typed expense ──
    if (type === 'text') {
      const prompt = buildPrompt(text)
      parts = [{ text: prompt }]
    }

    // ── VOICE MODE: transcribe audio + parse expense ──
    if (type === 'voice') {
      const prompt = buildPrompt(null) // voice version of prompt
      parts = [
        { text: prompt },
        {
          inlineData: {
            mimeType: 'audio/webm',
            data: audioBase64 // base64 audio from browser
          }
        }
      ]
    }

    // Call Gemini API using the new auth key format
    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500
          }
        })
      }
    )

    const geminiData = await geminiRes.json()

    // Extract the text response from Gemini
    const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    if (!responseText) {
      console.error('Empty Gemini response:', JSON.stringify(geminiData))
      return res.status(500).json({ error: 'Gemini returned empty response', raw: geminiData })
    }

    // Clean and parse JSON from Gemini's response
    const cleaned = responseText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim()

    let parsed = null
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      // Try extracting JSON from response
      const match = cleaned.match(/\{[\s\S]*\}/)
      if (match) {
        try { parsed = JSON.parse(match[0]) } catch {}
      }
    }

    if (!parsed) {
      return res.status(500).json({ error: 'Could not parse Gemini response', raw: responseText })
    }

    return res.status(200).json({ success: true, expense: parsed })

  } catch (err) {
    console.error('Gemini API error:', err)
    return res.status(500).json({ error: 'Server error: ' + err.message })
  }
}

// ── Build the AI prompt ───────────────────────
function buildPrompt(userText) {
  const inputLine = userText
    ? `The user typed: "${userText}"`
    : `The user has sent a voice recording. Listen to it and extract the expense details.`

  return `You are an expense parsing AI for an app called Spliq used in India.
${inputLine}

RULES:
- "paid", "I paid", "i paid" all mean the current user (You) paid
- Extract rupee amount (ignore ₹ or Rs symbols)
- Be smart about Indian names like Rahul, Ananya, Priya, Rohan, Karan, Vijay etc.
- If no people mentioned, people array should be empty
- If user says "with my flat" or "with the group" treat as group type

Return ONLY a valid JSON object, no markdown, no backticks, no explanation:
{
  "transcript": "what the user said or spoke",
  "amount": 500,
  "description": "dinner",
  "category": "🍽️ Food",
  "paidBy": "You",
  "people": ["Rahul", "Ananya"],
  "type": "personal",
  "groupName": ""
}

Category must be exactly one of:
🍽️ Food, 🚗 Travel, 🏨 Accommodation, 🎉 Entertainment, 🛒 Groceries, 💡 Utilities, 🧾 General

type is "personal" if 1-2 people involved, "group" if 3+ people or a group name is mentioned
paidBy is "You" if user said "I paid" or just "paid"
people lists everyone who owes money — NOT the payer
groupName is the group/trip name if mentioned, else empty string`
}
