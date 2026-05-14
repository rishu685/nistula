# NISTULA TECHNICAL ASSESSMENT — THINKING QUESTIONS

## SCENARIO
It is 3am. A guest at Villa B1 sends a WhatsApp message:

> "There is no hot water and we have guests arriving for breakfast in 4 hours. This is unacceptable. I want a refund for tonight."

---

## QUESTION A — THE IMMEDIATE RESPONSE

### The AI Reply (exactly as it would be sent at 3am)

> "Hi there! I'm so sorry you're experiencing this. We've marked this as urgent — our caretaker will call you within 15 minutes at the number on your booking to troubleshoot. If it's not resolved in 20 minutes, we'll arrange an emergency plumber. We'll also discuss the refund once this is fixed. You're not alone — we're on it."

### Why This Wording

1. **Acknowledge the crisis immediately** — not dismissive, validates frustration. "I'm so sorry" + "urgent" signals we get the severity.
2. **Concrete action within minutes** — "15 minutes" is specific and believable at 3am. Generic "we'll help soon" would feel hollow when breakfast is in 4 hours.
3. **Escalation path** — caretaker → plumber is clear. Guest knows exactly what will happen next.
4. **Defers refund discussion** — after the problem is solved, not before. Talking refund now looks like we're dodging the real issue (fixing their water).

This response has high confidence for auto-send because: complaint classification is certain, the reply addresses the core need, and it protects the business by being helpful without committing to refund immediately.

---

## QUESTION B — THE SYSTEM DESIGN

### Full System Response Beyond the Message

#### **Immediate Actions (0-2 minutes)**
1. **Message Classification**: System marks as `query_type="complaint"` and `confidence=0.95` (keywords: "no hot water", "unacceptable", "refund")
2. **Action Override**: Even if confidence was only 0.6, query_type="complaint" forces `action="escalate"` (see main.py logic)
3. **Conversation Created**: Auto-create conversation thread, mark `status="escalated"`, `unread_agent_messages=1`
4. **Alert Triggered**: SMS/Push to on-call manager: "🚨 URGENT: Villa B1 guest has NO HOT WATER. Breakfast in 4 hours. [Link to conversation]"

#### **Parallel Notifications (0-5 minutes)**
1. **Caretaker Notified**: SMS + WhatsApp to Vikram (caretaker): "URGENT: No hot water complaint, guest needs fix in 20 min. Call guest immediately: +91-XXXXX"
2. **Pattern Detection**: System checks `complaint_patterns` table for "no_hot_water" at villa-b1
   - If 2nd occurrence in 2 months → flag for maintenance review
   - If 3rd occurrence → auto-create escalation ticket to maintenance manager
3. **Booking Platform Alert**: If reservation was made via Airbnb/Booking.com, flag reservation as requiring follow-up (prevent auto-cancellation, protect rating)

#### **Agent Actions (5-30 minutes)**
1. **Agent Assignment**: Conversation assigned to available manager (marked `assigned_agent_id="mgr_001"`)
2. **Agent Dashboard**: Shows:
   - Full guest profile (prior bookings, review history)
   - Reservation details (check-in time, party size, who booked)
   - Our drafted WhatsApp reply (with 0.93 confidence)
   - 1-click buttons: "Send Reply", "Edit & Send", "Escalate"
3. **Agent Decision**: Agent reviews the drafted reply
   - Option A: Sends as-is (auto_send flow)
   - Option B: Edits it ("Sending plumber name to be transparent")
   - Option C: Calls guest directly instead

#### **If No Human Response (30 minutes)**
1. **Escalation Trigger**: If no agent clicked anything in 30 minutes, system:
   - Auto-sends the AI-drafted reply (caretaker is already notified anyway)
   - Creates urgent ticket in external system (Jira/Service Hub)
   - Escalates to operations manager: "No agent response in 30 min to critical 3am issue"
   - Logs the fact that system sent reply without agent approval

#### **Logging & Compliance**
- All interactions logged to `outbound_messages` table with timestamps
- `delivery_status="sent"` when WhatsApp delivery confirmed
- `action_taken_by="system"` if auto-escalated after 30 min
- Raw payload preserved for audit: error screenshots, exact complaint text

#### **Follow-up (4-24 hours)**
1. **Caretaker Reports Back**: Either "Fixed in 10 minutes, guest satisfied" or "Plumber called, arriving in 1 hour"
2. **Agent Updates**: Conversation marked `status="in_progress"` with notes
3. **Resolution Logging**: When fixed, mark `status="resolved"`, `resolution_type="emergency_fix"`
4. **Refund Decision**: If refund was offered, approval workflow triggered (manager approves, processes in billing system)
5. **Guest Follow-up**: 2 hours after hot water fixed, send: "We're sorry for the inconvenience. As discussed, we've credited INR 4,500 (1 night) to your account. Thank you for your patience."

---

## QUESTION C — THE LEARNING & PREVENTION

### The Pattern (3 "no hot water" complaints in 2 months)

This isn't a guest problem. This is a property problem. The system must detect this automatically.

### What Should Happen Immediately

1. **Pattern Detection in the Database**:
   ```
   complaint_patterns table detects:
   - property_id: villa-b1
   - pattern_type: "no_hot_water" 
   - complaint_count: 3
   - All within 60 days
   - Last one today
   → auto_set escalation_triggered=TRUE
   → escalation_timestamp=NOW()
   → escalation_to="ops_manager@nistula.com"
   ```

2. **Alert Operations Manager**:
   - Email: "PATTERN ALERT: Villa B1 has reported NO HOT WATER 3 times in 2 months (most recent: TODAY). This needs immediate investigation."
   - Include: Guest names, dates, booking references, exact quotes
   - Action: Caretaker should inspect water heater tomorrow

3. **System-Generated Tasks**:
   - Auto-create maintenance ticket: "Investigate hot water system at Villa B1"
   - Block new bookings for 24-48 hours while investigation happens (optional, depends on business rules)
   - Flag: "This property has reliability risk"

### What To Build To Prevent Complaint #4

#### **Prevention Layer 1: Proactive Monitoring**
- **IoT sensors** on water heater: Temperature, flow rate, pressure
- **Daily health check**: Caretaker or automated check confirms hot water working
- **Alert on failure**: If water temp drops below 40°C, caretaker gets alert before any guest does

#### **Prevention Layer 2: Preventive Maintenance**
- **Scheduled servicing**: Every 6 months (not waiting for complaint)
- **Spare parts strategy**: Keep backup water heater element + tools on-site
- **Caretaker training**: How to quickly restart/reset the system (video + manual)

#### **Prevention Layer 3: Guest Communication**
- **Pre-check-in message**: "If you experience any issues, here are quick fixes to try... if that doesn't work, text us immediately and we'll have our caretaker call you within 15 minutes"
- **Post-check-in call**: Caretaker calls after 2 hours to confirm everything is working ("Hi! Just confirming your hot water, WiFi, AC are all good?")

#### **Prevention Layer 4: Smart Escalation**
- **If one guest reports it**: Log in complaint_patterns, schedule maintenance within 7 days
- **If two guests report it**: Maintenance MUST happen within 24 hours
- **If three guests report it**: Emergency repair, either done today or property taken offline

### Business Logic to Implement

```python
# In the system (pseudocode):

def check_complaint_pattern(property_id, pattern_type):
    recent = complaint_patterns
        .where(property_id=property_id)
        .where(pattern_type=pattern_type)
        .where(created_at > NOW() - 60 days)
        .count()
    
    if recent >= 3:
        escalation_deadline = URGENT  # same day or next morning
        notify_ops_manager()
        notify_maintenance()
        block_new_bookings()  # optional
        return "CRITICAL"
    
    elif recent >= 2:
        escalation_deadline = 24 hours
        notify_ops_manager()
        return "HIGH_PRIORITY"
    
    else:
        escalation_deadline = 7 days
        log_for_review()
        return "SCHEDULED"
```

### The Bigger Picture

This is why the `complaint_patterns` table exists in the schema. With 3 villas and hundreds of guests, you can't notice patterns manually. The system must:

1. **Recognize** when problem X has happened N times recently
2. **Alert** the right person (maintenance manager, not just guest support)
3. **Prevent** it from becoming a reputation issue (Airbnb/Booking.com reviews)
4. **Fix** the root cause, not just manage complaints

By the third complaint about hot water, Villa B1's reputation is already at risk. The fourth complaint might be a public review that costs bookings. Building proactive detection saves more than it costs.

