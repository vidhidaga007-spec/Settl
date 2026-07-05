// api/gemini.js — Vercel serverless function
// Authentication: X-goog-api-key header (matches Google AI Studio official cURL)
// Model: gemini-2.0-flash-latest (matches Google AI Studio official cURL)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set in Vercel environment variables.' })
  }

  try {
    const { type, text, audioBase64 } = req.body

    let parts = []

    if (type === 'text') {
      parts = [{ text: buildPrompt(text) }]
    }

    if (type === 'voice') {
      parts = [
        { text: buildPrompt(null) },
        {
          inlineData: {
            mimeType: 'audio/webm',
            data: audioBase64
          }
        }
      ]
    }

    // Exact match to Google AI Studio official cURL:
    // POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-latest:generateContent
    // Header: X-goog-api-key: <API_KEY>
    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-latest:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 512
          }
        })
      }
    )

    const geminiData = await geminiRes.json()
    console.log('Gemini status:', geminiRes.status)
    console.log('Gemini response:', JSON.stringify(geminiData).slice(0, 500))

    if (!geminiRes.ok) {
      return res.status(500).json({
        error: 'Gemini API error',
        status: geminiRes.status,
        details: geminiData
      })
    }

    const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    if (!responseText) {
      return res.status(500).json({ error: 'Gemini returned empty response', raw: geminiData })
    }

    // Clean markdown formatting Gemini sometimes adds
    const cleaned = responseText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()

    // Parse JSON
    let parsed = null
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start !== -1 && end !== -1) {
        try { parsed = JSON.parse(cleaned.substring(start, end + 1)) } catch {}
      }
    }

    if (!parsed) {
      return res.status(500).json({ error: 'Could not parse JSON from Gemini', raw: responseText })
    }

    return res.status(200).json({ success: true, expense: parsed })

  } catch (err) {
    console.error('Server error:', err)
    return res.status(500).json({ error: 'Server error: ' + err.message })
  }
}

function buildPrompt(userText) {
  const inputLine = userText
    ? `The user typed: "${userText}"`
    : `The user sent a voice recording. Listen to it and extract the expense details.`

  return `You are an expense parsing AI for an app called Spliq used in India.
${inputLine}

RULES:
- "paid", "I paid", "i paid" all mean the current user (You) paid
- Extract the rupee amount — ignore ₹ or Rs symbols
- Be smart about Indian names like Rahul, Ananya, Priya, Rohan, Karan, Vijay, Arjun etc.
- If no people are mentioned, people array should be empty []
- type is "group" if 3+ people or a group/trip name is mentioned, else "personal"

Return ONLY raw JSON, no markdown, no backticks, no explanation:
{"transcript":"what the user said","amount":500,"description":"dinner","category":"🍽️ Food","paidBy":"You","people":["Rahul","Ananya"],"type":"personal","groupName":""}

category must be exactly one of:
🍽️ Food, 🚗 Travel, 🏨 Accommodation, 🎉 Entertainment, 🛒 Groceries, 💡 Utilities, 🧾 General

paidBy is "You" if user said "I paid" or just "paid"
people lists everyone who owes — NOT the payer
groupName is the group or trip name if mentioned, else ""`
}
