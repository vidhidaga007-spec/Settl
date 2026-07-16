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
    // Detect explicit split amounts like:
// Rahul owes 500
// Rahul 500
// Rahul:500
// Rahul - 500

const detectedSplits = []

const splitRegex =
/([A-Za-z]+)\s*(?:owes|should pay|pays|:|-)?\s*₹?\s*(\d+)/gi

let match

while ((match = splitRegex.exec(transcript)) !== null) {
  detectedSplits.push({
    person: match[1],
    amount: Number(match[2])
  })
}

console.log("Detected splits:", detectedSplits)

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
    const prompt = `You are Spliq's expense parsing AI.

The user said:

"${transcript}"

Your job is ONLY to extract information from the sentence.

Do NOT invent people.
Do NOT invent groups.
Do NOT guess if information is missing.

----------------------------------------
RULES
----------------------------------------

AMOUNT
Extract the numeric amount.

DESCRIPTION
Return a short description.

PAID BY

If the sentence begins with:

I paid
i paid
Paid
paid
I've paid

then

paidBy = "You"

If another person's name appears immediately before "paid",

Example

Khushi paid 500

then

paidBy = "Khushi"

Never include the payer inside the people array.

----------------------------------------

PEOPLE

Return ONLY the people explicitly mentioned.

Recognize ALL of these patterns:

with Rahul

with Rahul and me

with Rahul, Khushi and me

between Rahul and Khushi

among Rahul and Khushi

split with Rahul

Rahul owes 500

Rahul should pay 500

Rahul pays 500

Rahul 500

Rahul: 500

Rahul - 500

Rahul ₹500

If a person's name appears before an amount, treat that as an explicit split and include that person in the people array.

IMPORTANT

"me"

means

"You"

Examples

"I paid with Rahul"

people=["Rahul"]

"Khushi paid with me"

people=["You"]

"Khushi paid with Rahul and me"

people=["Rahul","You"]

If nobody is mentioned in either:

- with ...
- among ...
- between ...
- owes ...
- should pay ...

then

people=[]
----------------------------------------

SPLITS

By default,

splitType = "equal"

splits = []

However, if the user explicitly mentions how much each person owes, return

splitType = "unequal"

Also include every person mentioned in the splits inside the people array.

For example:

If the user says

Rahul owes 500 and Priya owes 200

then return

people=["Rahul","Priya"]
and populate the splits array.

Examples:

Input:
I paid 1000. Rahul owes 500 and Priya owes 200.

Output:

splitType = "unequal"

splits = [
{
"person":"Rahul",
"amount":500
},
{
"person":"Priya",
"amount":200
}
]

Input:
Dinner 900. Rahul 400. Khushi 300.

Output:

splitType = "unequal"

splits = [
{
"person":"Rahul",
"amount":400
},
{
"person":"Khushi",
"amount":300
}
]

If no individual amounts are mentioned,

splitType = "equal"

splits = []
----------------------------------------

GROUP

Return the group name ONLY if explicitly mentioned.

Otherwise

groupName=""

Do NOT guess.

----------------------------------------

CATEGORY

Choose ONLY ONE

🍽️ Food
🚗 Travel
🏨 Accommodation
🎉 Entertainment
🛒 Groceries
💡 Utilities
🧾 General

If unsure

return

🧾 General

----------------------------------------

TYPE

Return

"group"

ONLY if the user explicitly mentions a group.

Otherwise

"personal"

----------------------------------------

EXAMPLES

Input:
I paid 500 for dinner

Output:
{
"amount":500,
"description":"dinner",
"category":"🍽️ Food",
"paidBy":"You",
"people":[],
"type":"personal",
"groupName":""
}

Input:
I paid 800 for dinner with Khushi

Output:
{
"amount":800,
"description":"dinner",
"category":"🍽️ Food",
"paidBy":"You",
"people":["Khushi"],
"type":"personal",
"groupName":""
}

Input:
Khushi paid 1200 for cake with me

Output:
{
"amount":1200,
"description":"cake",
"category":"🍽️ Food",
"paidBy":"Khushi",
"people":["You"],
"type":"personal",
"groupName":""
}

Input:
Khushi paid 1600 for cab with Rahul and me

Output:
{
"amount":1600,
"description":"cab",
"category":"🚗 Travel",
"paidBy":"Khushi",
"people":["Rahul","You"],
"type":"personal",
"groupName":""
}

Input:
Rahul paid 600

Output:
{
"amount":600,
"description":"",
"category":"🧾 General",
"paidBy":"Rahul",
"people":[],
"type":"personal",
"groupName":""
}

Input:
I paid 2000 for Flat groceries

Output:
{
"amount":2000,
"description":"groceries",
"category":"🛒 Groceries",
"paidBy":"You",
"people":[],
"type":"group",
"groupName":"Flat"
}
Input:
I paid 1000 for dinner. Rahul owes 500 and Priya owes 200.

Output:
{
"amount":1000,
"description":"dinner",
"category":"🍽️ Food",
"paidBy":"You",
"people":["Rahul","Priya"],
"splitType":"unequal",
"splits":[
{
"person":"Rahul",
"amount":500
},
{
"person":"Priya",
"amount":200
}
],
"type":"personal",
"groupName":""
}

Input:
Dinner 1200 with Rahul and Khushi. Rahul 500. Khushi 300.

Output:
{
"amount":1200,
"description":"dinner",
"category":"🍽️ Food",
"paidBy":"You",
"people":["Rahul","Khushi"],
"splitType":"unequal",
"splits":[
{
"person":"Rahul",
"amount":500
},
{
"person":"Khushi",
"amount":300
}
],
"type":"personal",
"groupName":""
}
Input:
Paid 490 for dinner. Vidhi owes 200.

Output:
{
"amount":490,
"description":"dinner",
"category":"🍽️ Food",
"paidBy":"You",
"people":["Vidhi"],
"splitType":"unequal",
"splits":[
{
"person":"Vidhi",
"amount":200
}
],
"type":"personal",
"groupName":""
}
----------------------------------------

Return ONLY valid JSON.

Required format:

{
"transcript":"${transcript}",
"amount":0,
"description":"",
"category":"",
"paidBy":"",
"people":[],
"splitType":"equal",
"splits":[],
"type":"personal",
"groupName":""
}`
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
