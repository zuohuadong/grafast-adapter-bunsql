/**
 * Basic usage example for @dataplan/pg-bun
 */

import { makePgService, createWithPgClient } from "../src/index.js";

// Example 1: Using makePgService
const pgService = makePgService({
  connectionString: "postgres://localhost:5432/mydb",
  schemas: ["public"],
});

console.log("Created pgService with basic configuration");

// Example 2: Using createWithPgClient
const withPgClient = createWithPgClient({
  connectionString: "postgres://localhost:5432/mydb",
});

// Example 3: Simple query
async function basicQuery() {
  const result = await withPgClient(null, async (client) => {
    return await client.query({
      text: "SELECT version() as version",
      values: [],
    });
  });
  
  console.log("PostgreSQL version:", result.rows[0]?.version);
  return result;
}

// Example 4: Parameterized query
async function parameterizedQuery() {
  const result = await withPgClient(null, async (client) => {
    return await client.query({
      text: "SELECT * FROM users WHERE active = $1 LIMIT $2",
      values: [true, 5],
    });
  });
  
  console.log("Active users:", result.rows);
  return result;
}

// Example 5: Transaction
async function transactionExample() {
  const result = await withPgClient(null, async (client) => {
    return await client.withTransaction(async (tx) => {
      // First query
      await tx.query({
        text: "INSERT INTO audit_log (message) VALUES ($1)",
        values: ["Transaction started"],
      });
      
      // Second query
      await tx.query({
        text: "INSERT INTO users (name, email) VALUES ($1, $2)",
        values: ["Example User", "user@example.com"],
      });
      
      return { success: true };
    });
  });
  
  console.log("Transaction result:", result);
  return result;
}

// Example 6: Array mode
async function arrayModeExample() {
  const result = await withPgClient(null, async (client) => {
    return await client.query({
      text: "SELECT id, name FROM users LIMIT 3",
      values: [],
      arrayMode: true,
    });
  });
  
  // Result will be arrays instead of objects
  // [[1, "Alice"], [2, "Bob"], [3, "Charlie"]]
  console.log("Users (array mode):", result.rows);
  return result;
}

// Example 7: With pgSettings
async function withPgSettings() {
  const result = await withPgClient(
    { timezone: "America/New_York", statement_timeout: "10s" },
    async (client) => {
      return await client.query({
        text: "SELECT NOW() as current_time, current_setting('timezone') as timezone",
        values: [],
      });
    }
  );
  
  console.log("Current time and timezone:", result.rows[0]);
  return result;
}

// Run examples
async function runExamples() {
  try {
    console.log("=== Basic Usage Examples ===\n");
    
    await basicQuery();
    console.log("✓ Basic query completed\n");
    
    await parameterizedQuery();
    console.log("✓ Parameterized query completed\n");
    
    await transactionExample();
    console.log("✓ Transaction example completed\n");
    
    await arrayModeExample();
    console.log("✓ Array mode example completed\n");
    
    await withPgSettings();
    console.log("✓ pgSettings example completed\n");
    
    console.log("All examples completed successfully!");
  } catch (error) {
    console.error("Error running examples:", error);
  }
}

// Export for use in tests or other files
export {
  basicQuery,
  parameterizedQuery,
  transactionExample,
  arrayModeExample,
  withPgSettings,
  runExamples,
  pgService,
  withPgClient,
};

// Run examples if this file is executed directly
// Note: Using a simple check for execution context
if (typeof require !== 'undefined' && require.main === module) {
  runExamples();
}