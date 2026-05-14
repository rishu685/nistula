# Nistula Guest Message Handler — Technical Assessment

A production-ready backend system for receiving, normalizing, and responding to guest messages across multiple channels (WhatsApp, Booking.com, Airbnb, Instagram, direct) using Claude AI for intelligent reply generation.

Built with **Node.js + Express** for fast, scalable API development.

## Quick Start

### Prerequisites
- Node.js 16+
- npm or yarn
- PostgreSQL 12+ (optional for local development)
- Claude API key (provided in assessment)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/nistula-technical-assessment.git
   cd nistula-technical-assessment
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env and add your Claude API key
   ```

4. **Set up PostgreSQL database** (optional for assessment)
   ```bash
   psql -U postgres
   # CREATE DATABASE nistula;
   # \c nistula
   # \i schema.sql
   ```

5. **Run the server**
   ```bash
   npm start          # Production
   npm run dev        # Development (with auto-reload)
   ```

The API will be available at `http://localhost:8000`

---

## API Documentation

### POST /webhook/message

Receives an inbound guest message and returns a drafted reply with confidence score.

#### Request Body
```json
{
  "source": "whatsapp",
  "guest_name": "Rahul Sharma",
  "message": "Is the villa available from April 20 to 24? What is the rate for 2 adults?",
  "timestamp": "2026-05-05T10:30:00Z",
  "booking_ref": "NIS-2024-0891",
  "property_id": "villa-b1"
}
```

#### Response
```json
{
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "query_type": "pre_sales_availability",
  "drafted_reply": "Hi Rahul! Great news — Villa B1 is available April 20-24. Our base rate is INR 18,000/night (up to 4 guests). For 2 adults over 4 nights, that's INR 72,000. Would you like to know about our chef services or any other amenities?",
  "confidence_score": 0.91,
  "action": "auto_send"
}
```

#### Status Codes
- `200 OK` — Message processed successfully
- `400 Bad Request` — Invalid payload or missing required fields
- `500 Internal Server Error` — Claude API error or processing failure

---

## Confidence Scoring Logic

The confidence score (0.0-1.0) determines the action taken and represents our system's certainty that the AI-drafted reply is appropriate to send to the guest.

### Scoring Factors

#### 1. **Query Type Confidence** (Primary factor)
The classifier analyzes keywords in the message to determine category:
- Keyword match scoring for each category
- Highest scoring category is selected
- If multiple strong matches → lower confidence
- If weak/no matches → defaults to `general_enquiry`

**Example:**
- Message: "Is it available April 20-24?" → Strong match for `pre_sales_availability` → +0.1 base confidence
- Message: "Hot water not working" → Strong match for `complaint` → +0.15 base confidence

#### 2. **Claude Confidence Assertion**
Claude includes a self-assessed confidence score in its reply (0.0-1.0):
- Complex questions → Lower Claude confidence (0.6-0.7)
- Straightforward questions → Higher Claude confidence (0.85-0.95)
- Complaints or special requests → Variable based on severity

**Example responses:**
```
Query: "Is it available April 20-24?"
Claude reply: "Yes, Villa B1 is available those dates..."
Claude confidence: 0.93 (clear, factual answer)

Query: "Can we arrange an early check-in and pet bring a dog?"
Claude reply: "For early check-in, you'd need to contact our manager..."
Claude confidence: 0.72 (requires approval, not guaranteed)
```

#### 3. **Property Context Relevance**
- If query directly matches available property info (rates, amenities) → +0.05
- If query requires external approvals or escalation → -0.10

**Example:**
- "What's the WiFi password?" → +0.05 (available in context)
- "Can we have a wedding at the villa?" → -0.10 (requires manager approval)

#### 4. **Query Type Routing Rules**
- Complaints → Confidence capped at 0.75 (always escalated regardless of confidence)
- Pre-sales → Confidence typically 0.80-0.95 (factual data available)
- Post-sales checkin → Confidence typically 0.85-0.92 (operational questions)
- Special requests → Confidence typically 0.60-0.80 (requires approvals)

### Confidence Thresholds

| Score | Action | Meaning |
|-------|--------|---------|
| ≥ 0.85 | `auto_send` | Reply sent immediately to guest via WhatsApp/channel |
| 0.60-0.84 | `agent_review` | Reply held for agent to review, edit, and approve |
| < 0.60 | `escalate` | Reply sent to manager; may require human drafting |
| Any score | `escalate` | Always escalate if `query_type="complaint"` |

### Real Example Scoring

#### Example 1: Simple Availability Query
```
Message: "Is the villa available April 20-24?"

Scoring:
- Query type confidence: 0.95 (perfect match for pre_sales_availability keywords)
- Claude confidence: 0.93 (factual, clear answer)
- Context relevance: +0.05 (property data matches query)
- Final: min(0.95 + 0.93 + 0.05 / 3) = 0.91

→ ACTION: auto_send ✓
```

#### Example 2: Complaint with Urgency
```
Message: "There is no hot water and guests are arriving in 4 hours. This is unacceptable. I want a refund."

Scoring:
- Query type: complaint (detected keywords: "no hot water", "unacceptable", "refund")
- Claude confidence: 0.88 (appropriate response drafted)
- Context relevance: 0.50 (complaint requires human judgment)

→ ACTION: escalate (complaints always escalate, regardless of score)
   - SMS alert to caretaker
   - WhatsApp to manager with drafted reply
   - Conversation marked as urgent
```

#### Example 3: Complex Special Request
```
Message: "Can we arrange airport pickup at 2pm and hire your chef for a family dinner? We have a nut allergy."

Scoring:
- Query type: special_request (multiple requests, not standard)
- Claude confidence: 0.68 (requires approvals, mentions allergy/safety concern)
- Context relevance: -0.05 (chef pre-booking available, but pickup not guaranteed)
- Final: 0.68

→ ACTION: agent_review
   - Reply queued for agent
   - Agent sees: chef availability, notes about nut allergy, pickup request status
   - Agent edits reply to confirm chef availability and request allergy details
   - Agent sends edited reply
```

---

## Implementation Details

### Message Normalization

All messages are normalized to a unified schema regardless of source (Node.js):

```javascript
{
    message_id: "UUID",
    source: "whatsapp|booking_com|airbnb|instagram|direct",
    guest_name: "string",
    message_text: "string",
    timestamp: "ISO 8601",
    booking_ref: "string or null",
    property_id: "string",
    query_type: "one of 6 types"
}
```

### Query Type Classification

Classification happens in two stages:

1. **Keyword-based initial classification** (src/app.js)
   - Fast, deterministic
   - Pre-processes message text
   - Returns one of 6 categories

2. **Context-aware refinement by Claude** (optional, for complex cases)
   - Claude can clarify ambiguous classifications
   - Future enhancement for multi-turn conversations

### Error Handling

- **Claude API failures**: Returns 500 with error details; system logs request
- **Invalid payload**: Returns 400 with validation error
- **Missing API key**: Fails at startup with clear error message
- **Network errors**: Implements retry with exponential backoff (future enhancement)

---

## Database Schema

The full schema is in `schema.sql`. Key tables:

- `guests` — Guest profiles across all channels
- `inbound_messages` — All incoming messages with classification
- `outbound_messages` — All replies (AI-drafted and agent-edited)
- `conversations` — Threads of related messages
- `complaint_patterns` — Pattern detection for repeated issues
- `reservations` — Guest bookings linked to properties

See `schema.sql` for design decisions and rationale.

---

## Testing

Run the test suite with:

```bash
npm test
```

This will run 5 test cases covering different message types and scenarios. The test script includes:
- Pre-sales availability queries
- Urgent complaints requiring escalation
- Special requests with multiple requirements
- Post-sales check-in information
- General enquiries

### Manual Testing with cURL

You can also manually test the webhook:

```bash
curl -X POST http://localhost:8000/webhook/message \
  -H "Content-Type: application/json" \
  -d '{
    "source": "whatsapp",
    "guest_name": "Rahul Sharma",
    "message": "Is the villa available from April 20 to 24? What is the rate for 2 adults?",
    "timestamp": "2026-05-05T10:30:00Z",
    "booking_ref": "NIS-2024-0891",
    "property_id": "villa-b1"
  }'
```

---

## Production Considerations

### Scaling
- Load balance webhook endpoint behind cloud load balancer (AWS ALB, Google CLB)
- Redis queue for Claude API calls during high volume
- Database connection pooling (PgBouncer)

### Monitoring
- CloudWatch/DataDog for API latency
- Alert if confidence scores trending low (indicates classification drift)
- Track action distribution: are we escalating too much?

### Future Enhancements
1. **Multi-turn conversations** — Pass conversation history to Claude for context
2. **Sentiment analysis** — Detect frustration level and adjust response tone
3. **Translation** — Support messages in Hindi, Portuguese, etc.
4. **A/B testing** — Test different reply phrasings and track guest satisfaction
5. **ML classification** — Replace keyword-based classification with ML model
6. **Webhook retry logic** — Handle failed message deliveries gracefully

---

## File Structure

```
.
├── src/
│   ├── app.js               # Express application & webhook endpoint
│   └── __init__.py
├── schema.sql               # PostgreSQL schema with design docs
├── thinking.md              # Answers to Part 3 questions
├── README.md                # This file
├── package.json             # Node.js dependencies
├── test_webhook.js          # Automated test suite
├── .env.example             # Environment variables template
└── .gitignore
```

---

## Key Design Decisions

### Why Node.js + Express?
- **Fast startup and deployment** — Lightweight runtime with minimal overhead
- **JavaScript ecosystem** — Vast NPM package library for integrations
- **Non-blocking I/O** — Handles concurrent webhook requests efficiently
- **JSON-native** — Natural fit for webhook payloads and API responses
- **Easy horizontal scaling** — Can be deployed behind load balancers easily
- **Developer experience** — Familiar to most backend engineers

### Why Keyword-Based Classification?
- Fast and deterministic (good for volume)
- Easy to debug and audit ("why was this classified as X?")
- Works even when Claude API is rate-limited
- Can be enhanced with ML later without rewriting

### Why Store Everything?
- Every message, edit, and action logged for audit
- Support for 30-day lookback on complaint patterns
- Enable future analytics on guest satisfaction trends

---

## Support & Questions

For questions during the assessment, refer to:
1. This README for API usage and confidence scoring
2. `schema.sql` for database design rationale
3. `thinking.md` for Part 3 scenario analysis
4. Code comments in `src/main.py` for implementation details
---


