#!/usr/bin/env node
/**
 * Debug script to reproduce the 500 error for Zia Park Race 2
 */

// Mock Next.js req/res
const mockReq = {
  method: "POST",
  body: {
    track: "Zia Park",
    raceNo: "2",
    date: "2025-12-02",
    dateIso: "2025-12-02",
    dateRaw: "12/02/2025"
  },
  headers: {}
};

const mockRes = {
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    console.log("\n=== RESPONSE ===");
    console.log(`STATUS: ${this.statusCode || 200}`);
    console.log(JSON.stringify(data, null, 2));
    return this;
  }
};

// Import the handler
console.log("Loading verify_race handler...\n");

try {
  // In Next.js, API routes export a default function
  // We need to import it - but Next.js routes might not be directly importable
  // Let's try a different approach: read the file and extract the handler
  
  const fs = await import("fs");
  const path = await import("path");
  const filePath = path.resolve("pages/api/verify_race.js");
  
  // For now, let's just test the helper functions directly
  // We'll need to extract them or test via HTTP
  
  console.log("Testing via direct HTTP call to local server...");
  console.log("(Make sure Next.js dev server is running on port 3000)\n");
  
  const response = await fetch("http://localhost:3000/api/verify_race", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mockReq.body),
  });
  
  const text = await response.text();
  console.log(`HTTP Status: ${response.status}`);
  console.log(`Response Body:\n${text}`);
  
  if (response.status === 500) {
    console.error("\n❌ 500 Error detected!");
    try {
      const json = JSON.parse(text);
      console.error("Error JSON:", json);
    } catch (e) {
      console.error("Response is not JSON:", text.substring(0, 500));
    }
  }
  
} catch (err) {
  console.error("\n❌ ERROR CAUGHT:");
  console.error("Name:", err.name);
  console.error("Message:", err.message);
  console.error("Stack:\n", err.stack);
  process.exit(1);
}

