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

WHO PAID
- If the sentence starts with "I paid", "i paid", "Paid", "paid", "I've paid", the payer is "You".
- If a person's name comes immediately before the word "paid", that person is the payer.
  Example:
  "Khushi paid 500" → paidBy = "Khushi"
  "Rahul paid for dinner" → paidBy = "Rahul"
- Never put the payer inside the people array.

PEOPLE
- people contains ONLY the people who owe money.
- If no other people are mentioned, return [].
- If the payer is Khushi and nobody else is mentioned, return:
  paidBy = "Khushi"
  people = []

GROUPS
- type is "group" only if a group/trip name is mentioned.
- Otherwise type is "personal".

GENERAL
- Extract the rupee amount.
- Recognize Indian names.
Return ONLY raw JSON, no markdown, no backticks, no explanation whatsoever:
{"transcript":"${transcript}","amount":500,"description":"dinner","category":"🍽️ Food","paidBy":"You","people":["Rahul","Ananya"],"type":"personal","groupName":""}

category must be exactly one of:
🍽️ Food, 🚗 Travel, 🏨 Accommodation, 🎉 Entertainment, 🛒 Groceries, 💡 Utilities, 🧾 General

paidBy is the person who actually paid.
If the sentence begins with "I paid", "Paid", or "paid", use "You".
If a person's name appears immediately before the word "paid", use that person's name.

people contains ONLY the people who owe money.
Never include the payer in the people array.

groupName is the group or trip name if mentioned, else ""

`
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
