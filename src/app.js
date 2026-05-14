const express = require('express');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
const { Anthropic } = require('@anthropic-ai/sdk');

dotenv.config();

const app = express();
app.use(express.json());

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
if (!CLAUDE_API_KEY) {
  throw new Error('CLAUDE_API_KEY not found in environment variables');
}

const client = new Anthropic({
  apiKey: CLAUDE_API_KEY,
});

const PROPERTY_CONTEXT = `Property: Villa B1, Assagao, North Goa
Bedrooms: 3 | Max guests: 6 | Private pool: Yes
Check-in: 2pm | Check-out: 11am
Base rate: INR 18,000 per night (up to 4 guests)
Extra guest: INR 2,000 per night per person
WiFi password: Nistula@2024
Caretaker: Available 8am to 10pm
Chef on call: Yes, pre-booking required
Availability April 20-24: Available
Cancellation: Free up to 7 days before check-in`;

const QUERY_KEYWORDS = {
  pre_sales_availability: ['available', 'availability', 'dates', 'booking', 'reserve', 'when', 'period'],
  pre_sales_pricing: ['price', 'cost', 'rate', 'tariff', 'how much', 'expensive', 'charges', 'fee'],
  post_sales_checkin: ['check-in', 'checkin', 'check in', 'key', 'arrival', 'time', 'wifi', 'password'],
  special_request: ['early', 'late', 'request', 'arrange', 'special', 'transfer', 'pickup', 'change'],
  complaint: ['problem', 'issue', 'broken', 'not working', 'complain', 'unhappy', 'refund', 'compensate', 'terrible'],
  general_enquiry: ['pet', 'parking', 'bike', 'car', 'location', 'near', 'distance', 'allow', 'permitted']
};

function classifyQueryType(messageText) {
  const messageLower = messageText.toLowerCase();
  const scores = {};

  for (const [queryType, keywords] of Object.entries(QUERY_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (messageLower.includes(keyword)) {
        score += 1;
      }
    }
    scores[queryType] = score;
  }

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore > 0) {
    return Object.keys(scores).reduce((a, b) => (scores[a] > scores[b] ? a : b));
  }

  return 'general_enquiry';
}

function normalizeMessage(inbound) {
  const messageId = uuidv4();
  const queryType = classifyQueryType(inbound.message);

  return {
    message_id: messageId,
    source: inbound.source,
    guest_name: inbound.guest_name,
    message_text: inbound.message,
    timestamp: inbound.timestamp,
    booking_ref: inbound.booking_ref || null,
    property_id: inbound.property_id,
    query_type: queryType
  };
}

async function generateClaudeReply(unifiedMsg) {
  const prompt = `You are a friendly and professional guest relations AI for Nistula, a luxury vacation rental platform.
You are assisting with guest inquiries about Villa B1 in Assagao, North Goa.

PROPERTY INFORMATION:
${PROPERTY_CONTEXT}

GUEST MESSAGE:
Name: ${unifiedMsg.guest_name}
Booking Reference: ${unifiedMsg.booking_ref || 'Not provided'}
Query Type: ${unifiedMsg.query_type}
Message: ${unifiedMsg.message_text}
Timestamp: ${unifiedMsg.timestamp}

Please draft a helpful, warm, and professional reply to this guest message. The reply should:
1. Address their specific concern or question
2. Provide relevant information from the property details above
3. Be concise (2-3 sentences maximum)
4. Include a call-to-action if appropriate

After the reply, add a line with just a number between 0 and 1 representing how confident you are in this reply being appropriate and helpful (0.0 = very uncertain, 1.0 = very certain).

Format your response as:
[REPLY]
Your drafted reply here

[CONFIDENCE]
0.85`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = message.content[0].text;

    try {
      const parts = responseText.split('[CONFIDENCE]');
      const replyPart = parts[0].replace('[REPLY]', '').trim();
      const confidencePart = parts[1].trim();
      let confidence = parseFloat(confidencePart);
      
      confidence = Math.max(0.0, Math.min(1.0, confidence));

      return [replyPart, confidence];
    } catch (parseError) {
      return [responseText, 0.7];
    }
  } catch (error) {
    console.error('Claude API error:', error);
    throw error;
  }
}

function determineAction(confidenceScore, queryType) {
  if (queryType === 'complaint') {
    return 'escalate';
  }

  if (confidenceScore >= 0.85) {
    return 'auto_send';
  } else if (confidenceScore >= 0.60) {
    return 'agent_review';
  } else {
    return 'escalate';
  }
}

function validatePayload(payload) {
  const errors = [];

  if (!payload.source) errors.push('source is required');
  if (!['whatsapp', 'booking_com', 'airbnb', 'instagram', 'direct'].includes(payload.source)) {
    errors.push('source must be one of: whatsapp, booking_com, airbnb, instagram, direct');
  }

  if (!payload.guest_name) errors.push('guest_name is required');
  if (!payload.message) errors.push('message is required');
  if (!payload.timestamp) errors.push('timestamp is required');
  if (!payload.property_id) errors.push('property_id is required');

  if (payload.timestamp && isNaN(Date.parse(payload.timestamp))) {
    errors.push('timestamp must be a valid ISO 8601 datetime');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

app.post('/webhook/message', async (req, res) => {
  try {
    const validation = validatePayload(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid payload',
        details: validation.errors
      });
    }

    const unifiedMsg = normalizeMessage(req.body);
    const [draftedReply, confidenceScore] = await generateClaudeReply(unifiedMsg);
    const action = determineAction(confidenceScore, unifiedMsg.query_type);

    return res.status(200).json({
      message_id: unifiedMsg.message_id,
      query_type: unifiedMsg.query_type,
      drafted_reply: draftedReply,
      confidence_score: confidenceScore,
      action: action
    });

  } catch (error) {
    console.error('Error processing message:', error);
    return res.status(500).json({
      error: 'Error processing message',
      details: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

const PORT = process.env.API_PORT || 8000;
const HOST = process.env.API_HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`✓ Nistula Guest Message Handler running on ${HOST}:${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log(`✓ Webhook: POST http://localhost:${PORT}/webhook/message`);
});

module.exports = app;
