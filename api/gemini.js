// api/gemini.js — Vercel serverless function
// Calls Gemini API securely from the server using AQ. auth key
// Key is passed as a URL query parameter — the correct method for AQ. keys

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

    // ── KEY FIX: pass AQ. key as query parameter, not as a header ──
    // AQ. auth keys work on the native endpoint via ?key= query param
    // They fail with Authorization: Bearer and x-goog-api-key headers
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // No Authorization header — key is in the URL query param above
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 512
        }
      })
    })

    const geminiData = await geminiRes.json()

    // Log full response for debugging in Vercel logs
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

    // Clean markdown formatting Gemini sometimes wraps around JSON
    const cleaned = responseText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()

    // Parse JSON from Gemini response
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

Return ONLY a valid JSON object. No markdown. No backticks. No explanation. Just raw JSON:
{"transcript":"what the user said","amount":500,"description":"dinner","category":"🍽️ Food","paidBy":"You","people":["Rahul","Ananya"],"type":"personal","groupName":""}

category must be exactly one of:
🍽️ Food, 🚗 Travel, 🏨 Accommodation, 🎉 Entertainment, 🛒 Groceries, 💡 Utilities, 🧾 General

paidBy is "You" if user said "I paid" or just "paid"
people lists everyone who owes — NOT the payer
groupName is the group or trip name if mentioned, else empty string ""`
}
