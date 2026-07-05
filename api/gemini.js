// api/gemini.js — Vercel serverless function
// Uses Groq API — free, fast, works perfectly

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY not set in Vercel environment variables.' })
  }

  try {
    const { type, text, audioBase64 } = req.body
    let transcript = text || ''

    // ── VOICE: transcribe audio using Groq Whisper ──
    if (type === 'voice' && audioBase64) {
      const audioBuffer = Buffer.from(audioBase64, 'base64')

      // Build multipart form data manually (no external libraries needed)
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2)
      const CRLF = '\r\n'

      const header = Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="audio.webm"${CRLF}` +
        `Content-Type: audio/webm${CRLF}${CRLF}`
      )
      const modelPart = Buffer.from(
        `${CRLF}--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
        `whisper-large-v3${CRLF}` +
        `--${boundary}--${CRLF}`
      )

      const body = Buffer.concat([header, audioBuffer, modelPart])

      const transcribeRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + GROQ_API_KEY,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body
      })

      const transcribeData = await transcribeRes.json()
      console.log('Whisper status:', transcribeRes.status)
      console.log('Whisper response:', JSON.stringify(transcribeData))

      transcript = transcribeData.text || ''

      if (!transcript) {
        return res.status(400).json({
          error: 'Could not transcribe audio. Please try speaking more clearly or type the expense.'
        })
      }
    }

    // ── PARSE: extract expense details using Groq LLM ──
    const prompt = `You are an expense parsing AI for an app called Spliq used in India.
The user said or typed: "${transcript}"

RULES:
- "paid", "I paid", "i paid" all mean the current user (You) paid
- Extract the rupee amount — ignore ₹ or Rs symbols
- Be smart about Indian names like Rahul, Ananya, Priya, Rohan, Karan, Vijay, Arjun etc.
- If no people are mentioned, people array should be empty []
- type is "group" if 3+ people or a group/trip name is mentioned, else "personal"

Return ONLY raw JSON, no markdown, no backticks, no explanation whatsoever:
{"transcript":"${transcript}","amount":500,"description":"dinner","category":"🍽️ Food","paidBy":"You","people":["Rahul","Ananya"],"type":"personal","groupName":""}

category must be exactly one of:
🍽️ Food, 🚗 Travel, 🏨 Accommodation, 🎉 Entertainment, 🛒 Groceries, 💡 Utilities, 🧾 General

paidBy is "You" if user said "I paid" or just "paid"
people lists everyone who owes — NOT the payer
groupName is the group or trip name if mentioned, else ""`

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 512
      })
    })

    const groqData = await groqRes.json()
    console.log('Groq status:', groqRes.status)
    console.log('Groq response:', JSON.stringify(groqData).slice(0, 500))

    if (!groqRes.ok) {
      return res.status(500).json({ error: 'Groq API error', details: groqData })
    }

    const responseText = groqData?.choices?.[0]?.message?.content || ''

    if (!responseText) {
      return res.status(500).json({ error: 'Empty response from Groq' })
    }

    // Clean and parse JSON
    const cleaned = responseText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()

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
      return res.status(500).json({ error: 'Could not parse JSON from response', raw: responseText })
    }

    return res.status(200).json({ success: true, expense: parsed })

  } catch (err) {
    console.error('Server error:', err)
    return res.status(500).json({ error: 'Server error: ' + err.message })
  }
}
