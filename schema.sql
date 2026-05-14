-- ============================================================================
-- NISTULA UNIFIED MESSAGING PLATFORM - DATABASE SCHEMA
-- ============================================================================
-- This schema supports a multi-channel guest messaging system that tracks
-- messages, conversations, guest profiles, and AI-assisted reply workflows.
-- ============================================================================

-- ============================================================================
-- GUESTS TABLE
-- ============================================================================
-- Stores unique guest profiles across all channels
-- Purpose: One record per guest across WhatsApp, Booking.com, Airbnb, etc.
-- Design Decision: Using email_hash for deduplication when direct email
-- is available; using phone_hash as fallback. Multiple source_records stores
-- channel-specific identifiers for potential linking across channels.

CREATE TABLE guests (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Guest identification
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    email_hash VARCHAR(64),  -- SHA-256 hash for privacy
    phone_hash VARCHAR(64),  -- SHA-256 hash for privacy
    
    -- Guest metadata
    country VARCHAR(100),
    average_rating DECIMAL(2, 1),  -- From booking platforms
    total_bookings INTEGER DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    
    -- Source tracking (JSON array of {channel, external_id})
    source_records JSONB,
    
    -- Soft delete
    deleted_at TIMESTAMP,
    
    -- Indexes for lookups
    UNIQUE(email_hash) WHERE deleted_at IS NULL,
    UNIQUE(phone_hash) WHERE deleted_at IS NULL,
    INDEX idx_guests_created (created_at),
    INDEX idx_guests_updated (updated_at)
);


-- ============================================================================
-- PROPERTIES TABLE
-- ============================================================================
-- Stores property information for context in message handling

CREATE TABLE properties (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Property identification
    property_id VARCHAR(50) NOT NULL UNIQUE,  -- e.g., "villa-b1"
    name VARCHAR(255) NOT NULL,
    location VARCHAR(500),
    
    -- Property details
    bedrooms INTEGER,
    max_guests INTEGER,
    amenities JSONB,  -- e.g., {pool, wifi, chef, caretaker}
    
    -- Pricing
    base_rate_per_night_inr INTEGER,
    extra_guest_rate_inr INTEGER,
    
    -- Operational hours
    check_in_time VARCHAR(10),  -- "2pm"
    check_out_time VARCHAR(10),  -- "11am"
    caretaker_available_from VARCHAR(10),
    caretaker_available_to VARCHAR(10),
    
    -- Contact
    caretaker_contact VARCHAR(20),
    manager_contact VARCHAR(20),
    
    INDEX idx_properties_id (property_id)
);


-- ============================================================================
-- RESERVATIONS TABLE
-- ============================================================================
-- Stores reservation information linked to guests and properties
-- Purpose: Links guest inquiries to actual bookings for context

CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- References
    guest_id INTEGER NOT NULL,
    property_id INTEGER NOT NULL,
    booking_ref VARCHAR(50) NOT NULL UNIQUE,  -- e.g., "NIS-2024-0891"
    
    -- Reservation dates
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    number_of_guests INTEGER NOT NULL,
    
    -- Reservation status
    status VARCHAR(50) NOT NULL,  -- pending, confirmed, checked-in, completed, cancelled
    
    -- Total cost
    total_cost_inr INTEGER,
    
    -- Cancellation policy
    cancellation_deadline DATE,
    
    FOREIGN KEY (guest_id) REFERENCES guests(id),
    FOREIGN KEY (property_id) REFERENCES properties(id),
    INDEX idx_reservations_guest (guest_id),
    INDEX idx_reservations_booking_ref (booking_ref),
    INDEX idx_reservations_status (status)
);


-- ============================================================================
-- INBOUND_MESSAGES TABLE
-- ============================================================================
-- Stores all inbound guest messages from all channels
-- Purpose: Audit trail of all incoming messages with AI classification

CREATE TABLE inbound_messages (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Message identification
    message_id UUID NOT NULL UNIQUE,
    source VARCHAR(50) NOT NULL,  -- whatsapp, booking_com, airbnb, instagram, direct
    guest_id INTEGER NOT NULL,
    reservation_id INTEGER,  -- NULL if inquiry not linked to booking
    property_id INTEGER NOT NULL,
    
    -- Message content
    guest_name VARCHAR(255) NOT NULL,
    message_text TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    
    -- Source reference
    booking_ref VARCHAR(50),
    external_message_id VARCHAR(255),  -- e.g., WhatsApp message ID
    
    -- AI Analysis
    query_type VARCHAR(50) NOT NULL,  -- pre_sales_availability, pre_sales_pricing, etc.
    ai_classification_confidence DECIMAL(3, 2),
    
    -- Metadata
    language VARCHAR(10) DEFAULT 'en',
    raw_payload JSONB,  -- Preserve original payload
    
    FOREIGN KEY (guest_id) REFERENCES guests(id),
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    FOREIGN KEY (property_id) REFERENCES properties(id),
    INDEX idx_inbound_message_id (message_id),
    INDEX idx_inbound_guest (guest_id),
    INDEX idx_inbound_property (property_id),
    INDEX idx_inbound_query_type (query_type),
    INDEX idx_inbound_created (created_at)
);


-- ============================================================================
-- OUTBOUND_MESSAGES TABLE
-- ============================================================================
-- Stores all outbound replies (AI-drafted and agent-edited)
-- Purpose: Track drafted, edited, and sent messages with actions taken

CREATE TABLE outbound_messages (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- References
    inbound_message_id BIGINT NOT NULL,
    message_id UUID NOT NULL UNIQUE,
    
    -- AI-Generated content
    ai_drafted_reply TEXT NOT NULL,
    ai_confidence_score DECIMAL(3, 2) NOT NULL,
    ai_reasoning JSONB,  -- Store why the AI generated this reply
    
    -- Agent workflow
    agent_edited_reply TEXT,  -- If agent reviewed and changed the reply
    agent_id VARCHAR(100),  -- WHO edited
    agent_edit_timestamp TIMESTAMP,  -- WHEN they edited
    agent_edit_reason TEXT,  -- WHY they edited
    
    -- Final message state
    final_reply TEXT NOT NULL,  -- Either AI drafted or agent edited
    
    -- Action taken
    action VARCHAR(50) NOT NULL,  -- auto_send, agent_review, escalate
    action_taken_at TIMESTAMP,
    action_taken_by VARCHAR(100),  -- agent or system
    
    -- Delivery tracking
    delivery_status VARCHAR(50) DEFAULT 'pending',  -- pending, sent, failed, read
    delivery_timestamp TIMESTAMP,
    external_message_id VARCHAR(255),  -- After sending to WhatsApp, etc.
    
    FOREIGN KEY (inbound_message_id) REFERENCES inbound_messages(id),
    INDEX idx_outbound_inbound (inbound_message_id),
    INDEX idx_outbound_action (action),
    INDEX idx_outbound_delivery_status (delivery_status),
    INDEX idx_outbound_created (created_at)
);


-- ============================================================================
-- CONVERSATIONS TABLE
-- ============================================================================
-- Groups related messages into conversations
-- Purpose: Link multi-turn conversations together for context

CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Conversation identification
    conversation_id UUID NOT NULL UNIQUE,
    guest_id INTEGER NOT NULL,
    property_id INTEGER NOT NULL,
    reservation_id INTEGER,  -- NULL for pre-sales
    
    -- Thread info
    source VARCHAR(50) NOT NULL,  -- whatsapp, booking_com, etc.
    external_thread_id VARCHAR(255),  -- WhatsApp chat ID, etc.
    
    -- Status
    status VARCHAR(50) NOT NULL,  -- active, resolved, pending, escalated
    assigned_agent_id VARCHAR(100),
    
    -- Counters
    message_count INTEGER DEFAULT 0,
    unread_agent_messages INTEGER DEFAULT 0,
    unread_guest_messages INTEGER DEFAULT 0,
    
    -- Last activity
    last_message_at TIMESTAMP,
    last_agent_response_at TIMESTAMP,
    
    -- Resolution
    resolved_at TIMESTAMP,
    resolution_type VARCHAR(50),  -- auto_resolved, agent_resolved, guest_satisfied
    resolution_notes TEXT,
    
    FOREIGN KEY (guest_id) REFERENCES guests(id),
    FOREIGN KEY (property_id) REFERENCES properties(id),
    FOREIGN KEY (reservation_id) REFERENCES reservations(id),
    INDEX idx_conversations_guest (guest_id),
    INDEX idx_conversations_status (status),
    INDEX idx_conversations_assigned_agent (assigned_agent_id)
);


-- ============================================================================
-- CONVERSATION_MESSAGES JUNCTION
-- ============================================================================
-- Links inbound and outbound messages to conversations

CREATE TABLE conversation_messages (
    id SERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL,
    inbound_message_id BIGINT,
    outbound_message_id BIGINT,
    sequence_order INTEGER NOT NULL,
    direction VARCHAR(10) NOT NULL,  -- 'in' or 'out'
    
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (inbound_message_id) REFERENCES inbound_messages(id),
    FOREIGN KEY (outbound_message_id) REFERENCES outbound_messages(id),
    INDEX idx_conv_messages_conv (conversation_id),
    INDEX idx_conv_messages_sequence (conversation_id, sequence_order)
);


-- ============================================================================
-- PATTERNS & ESCALATIONS TABLE
-- ============================================================================
-- Tracks complaint patterns and escalation history
-- Purpose: For Part 3 - detecting repeated issues at properties

CREATE TABLE complaint_patterns (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Pattern identification
    property_id INTEGER NOT NULL,
    pattern_type VARCHAR(100) NOT NULL,  -- e.g., "no_hot_water", "wifi_down"
    complaint_keywords TEXT,  -- Comma-separated: "hot water, water heating"
    
    -- Pattern frequency
    complaint_count INTEGER DEFAULT 1,
    last_complaint_at TIMESTAMP,
    first_complaint_at TIMESTAMP,
    
    -- Escalation
    escalation_threshold INTEGER DEFAULT 3,  -- Escalate after 3rd occurrence
    escalation_triggered BOOLEAN DEFAULT FALSE,
    escalation_timestamp TIMESTAMP,
    escalation_to VARCHAR(100),  -- Email/contact of escalation recipient
    
    -- Prevention action
    recommended_action TEXT,  -- What should be fixed
    action_status VARCHAR(50),  -- pending, in_progress, completed
    action_completed_at TIMESTAMP,
    
    FOREIGN KEY (property_id) REFERENCES properties(id),
    INDEX idx_patterns_property (property_id),
    INDEX idx_patterns_type (pattern_type)
);


-- ============================================================================
-- DESIGN DECISIONS & COMMENTS
-- ============================================================================

-- 1. GUEST DEDUPLICATION:
--    Challenge: Same guest might contact through WhatsApp, Booking.com, Airbnb
--    Solution: email_hash and phone_hash for secure deduplication + source_records JSONB
--    to maintain audit trail. Using hashes instead of plain email/phone for privacy.

-- 2. CONVERSATION THREADING:
--    Challenge: Multi-turn conversations need context, but must span multiple channels
--    Solution: conversations table with many-to-many junction to messages.
--    This allows "virtual conversations" that might start on WhatsApp, get transferred
--    to email, and tracked as one thread.

-- 3. OUTBOUND MESSAGE WORKFLOW:
--    Challenge: Messages go through: AI drafted → Agent review (optional) → Final → Sent
--    Solution: Separate outbound_messages table with both ai_drafted_reply and 
--    final_reply fields. Tracks WHO edited, WHEN, and WHY. Allows audit trail.

-- 4. COMPLAINT PATTERN DETECTION:
--    Challenge: For Part 3 - need to detect "3rd time in 2 months" patterns
--    Solution: complaint_patterns table with escalation_threshold and tracking.
--    When same pattern_type hits threshold at same property, auto-escalate to manager.

-- 5. FLEXIBLE MESSAGE INDEXING:
--    Multiple indexes on created_at, query_type, status to support:
--    - Daily report queries
--    - Filter by complaint/escalation
--    - Time-series analytics

-- 6. PROPERTY CONTEXT STORED IN DB:
--    Rather than hard-coded property context in API, store in properties table.
--    Allows multi-property deployment and real-time updates.

-- 7. SOFT DELETES:
--    Using deleted_at instead of hard delete for compliance and audit trails.
--    Especially important for guests table (GDPR right-to-be-forgotten handled separately).

-- ============================================================================
-- HARDEST DESIGN DECISION: The Conversation/Message Relationship
-- ============================================================================

-- The core challenge: How do we maintain conversation context across channels
-- and multiple turns while keeping the query type classification per MESSAGE?
--
-- Initial approach: Store query_type on conversations table. PROBLEM: A conversation
-- might START as pre_sales_availability ("Is it available?") but EVOLVE into 
-- special_request ("Can we arrange a chef?"). One query_type per conversation loses this.
--
-- Final approach: Store query_type on EACH inbound_message (not on conversation).
-- Each turn gets its own classification. Conversations table just threads them together.
-- This preserves the evolution of the conversation while allowing per-message AI analysis.
--
-- Why this works:
-- 1. AI processes each message independently (correct for generation)
-- 2. Conversations link related messages (useful for agent review)
-- 3. We can analyze "conversation evolution" by looking at query_type changes
-- 4. Agents see full thread context but AI didn't need it to generate reply
-- 5. Future multi-turn Claude calls can reference prior messages in same conversation
--
-- Trade-off: Slightly more complex schema, but significantly more flexible.
-- Supports both simple one-off inquiries AND complex multi-turn negotiations.

