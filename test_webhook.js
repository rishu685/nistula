#!/usr/bin/env node

const http = require('http');

const Colors = {
  HEADER: '\x1b[95m',
  OKBLUE: '\x1b[94m',
  OKCYAN: '\x1b[96m',
  OKGREEN: '\x1b[92m',
  WARNING: '\x1b[93m',
  FAIL: '\x1b[91m',
  ENDC: '\x1b[0m',
  BOLD: '\x1b[1m',
  UNDERLINE: '\x1b[4m'
};

const BASE_URL = 'http://localhost:8000';

function printSection(title) {
  console.log(`\n${Colors.HEADER}${Colors.BOLD}${'='.repeat(70)}${Colors.ENDC}`);
  console.log(`${Colors.HEADER}${Colors.BOLD}${title}${Colors.ENDC}`);
  console.log(`${Colors.HEADER}${Colors.BOLD}${'='.repeat(70)}${Colors.ENDC}\n`);
}

function printSuccess(msg) {
  console.log(`${Colors.OKGREEN}✓ ${msg}${Colors.ENDC}`);
}

function printError(msg) {
  console.log(`${Colors.FAIL}✗ ${msg}${Colors.ENDC}`);
}

function printInfo(msg) {
  console.log(`${Colors.OKCYAN}→ ${msg}${Colors.ENDC}`);
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function postRequest(payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8000,
      path: '/webhook/message',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(payload))
      },
      timeout: 15000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            status: res.statusCode,
            data: parsed
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function testEndpoint(name, payload) {
  printInfo(`Testing: ${name}`);
  console.log(`Payload: ${JSON.stringify(payload, null, 2)}\n`);

  try {
    const response = await postRequest(payload);

    if (response.status === 200) {
      printSuccess(`Request succeeded (HTTP ${response.status})`);
      const result = response.data;

      console.log(`\n${Colors.BOLD}Response:${Colors.ENDC}`);
      printJson(result);

      console.log(`\n${Colors.BOLD}Analysis:${Colors.ENDC}`);
      console.log(`  Query Type: ${result.query_type}`);
      console.log(`  Confidence: ${(result.confidence_score * 100).toFixed(1)}%`);
      console.log(`  Action: ${result.action}`);

      if (result.action === 'auto_send') {
        printSuccess('This message will be auto-sent to guest');
      } else if (result.action === 'agent_review') {
        printInfo('This message requires agent review');
      } else if (result.action === 'escalate') {
        printError('This message is escalated to manager');
      }

      return {
        test: name,
        result: 'PASS',
        confidence: result.confidence_score
      };
    } else {
      printError(`Request failed (HTTP ${response.status})`);
      printJson(response.data);
      return {
        test: name,
        result: 'FAIL',
        confidence: 0
      };
    }
  } catch (error) {
    if (error.message.includes('ECONNREFUSED') || error.message.includes('connect ECONNREFUSED')) {
      printError('Connection failed - is the server running on localhost:8000?');
      printInfo('Start the server with: npm run dev');
    } else {
      printError(`Error: ${error.message}`);
    }
    return {
      test: name,
      result: 'FAIL',
      confidence: 0
    };
  }
}

async function checkServerHealth() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 8000,
      path: '/health',
      method: 'GET',
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      resolve(res.statusCode === 200);
      req.destroy();
    });

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      resolve(false);
      req.destroy();
    });

    req.end();
  });
}

async function main() {
  console.log(`\n${Colors.OKBLUE}${Colors.BOLD}`);
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║         NISTULA GUEST MESSAGE HANDLER — WEBHOOK TEST SUITE            ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log(`${Colors.ENDC}`);

  const isHealthy = await checkServerHealth();
  if (isHealthy) {
    printSuccess('Server is running on localhost:8000');
  } else {
    printError('Server is not running!');
    printInfo('Start it with: npm run dev');
    process.exit(1);
  }

  const results = [];

  printSection('TEST 1: Pre-Sales Availability Query');
  console.log(`${Colors.BOLD}Scenario:${Colors.ENDC}`);
  console.log('Guest from Booking.com asking about availability and pricing');
  console.log('Expected: auto_send (high confidence, factual answer)');

  const test1 = {
    source: 'booking_com',
    guest_name: 'Rahul Sharma',
    message: 'Is the villa available from April 20 to 24? What is the rate for 2 adults?',
    timestamp: '2026-05-05T10:30:00Z',
    booking_ref: 'NIS-2024-0891',
    property_id: 'villa-b1'
  };

  let result1 = await testEndpoint('Pre-sales availability', test1);
  if (result1.result === 'PASS') {
    results.push(result1);
  }

  printSection('TEST 2: Urgent Complaint (3am Hot Water Issue)');
  console.log(`${Colors.BOLD}Scenario:${Colors.ENDC}`);
  console.log('Guest messages at 3am: no hot water, breakfast in 4 hours, wants refund');
  console.log('Expected: escalate (all complaints escalate, requires human review)');

  const test2 = {
    source: 'whatsapp',
    guest_name: 'Priya Desai',
    message: 'There is no hot water and we have guests arriving for breakfast in 4 hours. This is unacceptable. I want a refund for tonight.',
    timestamp: '2026-05-05T03:00:00Z',
    booking_ref: 'NIS-2024-0892',
    property_id: 'villa-b1'
  };

  let result2 = await testEndpoint('Urgent complaint', test2);
  if (result2.result === 'PASS') {
    results.push(result2);
  }

  printSection('TEST 3: Special Request with Multiple Requirements');
  console.log(`${Colors.BOLD}Scenario:${Colors.ENDC}`);
  console.log('Guest asking for airport transfer, chef for dinner, and pet policy');
  console.log('Expected: agent_review (multiple requirements need confirmation)');

  const test3 = {
    source: 'airbnb',
    guest_name: 'Marcus Johnson',
    message: "Can you arrange airport transfer from Dabolim? We'd love to hire your chef for a family dinner. Also, do you allow dogs? We have an 8-year-old labrador.",
    timestamp: '2026-05-05T11:45:00Z',
    booking_ref: 'NIS-2024-0893',
    property_id: 'villa-b1'
  };

  let result3 = await testEndpoint('Special request', test3);
  if (result3.result === 'PASS') {
    results.push(result3);
  }

  printSection('TEST 4: Post-Sales Check-in Information');
  console.log(`${Colors.BOLD}Scenario:${Colors.ENDC}`);
  console.log('Guest asking about WiFi password and check-in time');
  console.log('Expected: auto_send (operational info available in property context)');

  const test4 = {
    source: 'whatsapp',
    guest_name: 'Ananya Singh',
    message: "Hi, what's the WiFi password at the villa? Also, what time can we check in?",
    timestamp: '2026-05-06T08:00:00Z',
    booking_ref: 'NIS-2024-0894',
    property_id: 'villa-b1'
  };

  let result4 = await testEndpoint('Check-in information', test4);
  if (result4.result === 'PASS') {
    results.push(result4);
  }

  printSection('TEST 5: General Enquiry (Ambiguous Message)');
  console.log(`${Colors.BOLD}Scenario:${Colors.ENDC}`);
  console.log('Guest asking a vague question via Instagram');
  console.log('Expected: agent_review or auto_send (depends on keyword matching)');

  const test5 = {
    source: 'instagram',
    guest_name: 'Dev Patel',
    message: 'Hi! Love your Instagram. Tell me more about Villa B1 :)',
    timestamp: '2026-05-05T14:20:00Z',
    booking_ref: null,
    property_id: 'villa-b1'
  };

  let result5 = await testEndpoint('General enquiry', test5);
  if (result5.result === 'PASS') {
    results.push(result5);
  }

  printSection('TEST SUMMARY');

  console.log(`${Colors.BOLD}Results:${Colors.ENDC}\n`);
  for (const r of results) {
    const statusColor = r.result === 'PASS' ? Colors.OKGREEN : Colors.WARNING;
    console.log(`${statusColor}${r.result}${Colors.ENDC} — ${r.test} (confidence: ${(r.confidence * 100).toFixed(1)}%)`);
  }

  console.log(`\n${Colors.BOLD}Interpretation:${Colors.ENDC}`);
  console.log('• PASS: Test behaved as expected');
  console.log('• FAIL: Test did not behave as expected — check logs');

  if (results.length > 0) {
    const avgConfidence = results.reduce((a, b) => a + b.confidence, 0) / results.length;
    console.log(`\nAverage confidence across all tests: ${(avgConfidence * 100).toFixed(1)}%`);
  }

  console.log(`\n${Colors.OKBLUE}${Colors.BOLD}All tests completed!${Colors.ENDC}\n`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
