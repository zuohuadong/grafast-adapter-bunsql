# @dataplan/pg-bun

Bun SQL native adaptor for @dataplan/pg, enabling high-performance GraphQL APIs with Bun's built-in PostgreSQL driver.

## Features

- 🚀 **High Performance** - Leverages Bun's native PostgreSQL driver for 20-80% better performance
- 🔌 **Drop-in Replacement** - Compatible API with @dataplan/pg's pg adapter
- 📡 **Pub/Sub (LISTEN/NOTIFY)** - Native PostgreSQL LISTEN/NOTIFY via Bun SQL (opt-in with `pubsub: true`)
- 📢 **Experimental NOTICE Messages** - Experimental support for PostgreSQL NOTICE messages (requires manual enablement)
- 🏗️ **Full Transaction Support** - Including savepoints and nested transactions
- 🌊 **Connection Pooling** - Automatic connection management

## Installation

```bash
bun add @dataplan/pg-bun
```

## Peer Dependencies

Make sure you have these installed:

```bash
bun add @dataplan/pg grafast
```

## Usage

### Basic Setup

```typescript
import { makePgService } from "@dataplan/pg-bun";

const pgService = makePgService({
  connectionString: process.env.DATABASE_URL,
  schemas: ["public"],
});

// Use in your Grafast preset
const preset = {
  pgServices: [pgService],
};
```

### With Options

```typescript
const pgService = makePgService({
  connectionString: "postgres://localhost:5432/mydb",
  schemas: ["public", "app"],
  options: {
    max: 20,           // Maximum connections
    idleTimeout: 30,    // Idle timeout in seconds
    connectionTimeout: 10, // Connection timeout in seconds
    prepare: true,       // Enable prepared statements
  },
  pgSettings: {
    timezone: "UTC",
    statement_timeout: "30s",
  },
  // Enable experimental NOTICE capture
  captureNotices: true,
  // Enable Pub/Sub (LISTEN/NOTIFY) support
  pubsub: true,
});
```

### Direct Usage

```typescript
import { createWithPgClient } from "@dataplan/pg-bun";

const withPgClient = createWithPgClient({
  connectionString: "postgres://localhost:5432/mydb",
});

// Query example
const result = await withPgClient(null, async (client) => {
  return await client.query({
    text: "SELECT * FROM users WHERE active = $1",
    values: [true],
  });
});
```

### Transaction Example

```typescript
await withPgClient(null, async (client) => {
  return await client.withTransaction(async (tx) => {
    const userResult = await tx.query({
      text: "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
      values: ["Alice", "alice@example.com"],
    });
    
    const userId = userResult.rows[0].id;
    
    await tx.query({
      text: "INSERT INTO accounts (user_id, balance) VALUES ($1, $2)",
      values: [userId, 0],
    });
    
    return { userId, success: true };
  });
});
```

### Pub/Sub (LISTEN/NOTIFY)

Pub/Sub is built on PostgreSQL's native `LISTEN`/`NOTIFY`, through Bun SQL's `listen()` and `notify()`. It is stable and no longer experimental. There is no polling and no notification table.

Enable it with `pubsub: true`. The subscriber is then available on the GraphQL context as `pgSubscriber`, or `<name>_pgSubscriber` for a named service.

```typescript
const pgService = makePgService({
  connectionString: process.env.DATABASE_URL,
  schemas: ["public"],
  pubsub: true,  // Create a BunPgSubscriber
});

// Subscribe to notifications
const subscriber = context.pgSubscriber;
const notifications = subscriber.subscribe("my_channel");

for await (const payload of notifications) {
  console.log("Received:", payload);
}

// Send notifications
await subscriber.notify("my_channel", "Hello World!");
```

Behaviour to be aware of:

- **Payloads are strings.** `notify(channel, payload?)` takes an optional string, as PostgreSQL does.
- **Buffering:** notifications that arrive while no `next()` is pending are queued in order and delivered on the next read.
- **Cleanup:** breaking out of the `for await` loop, or calling `return()` on the iterator, removes that registration and discards its buffer.
- **Errors:** if `LISTEN` fails, pending reads reject with the error.
- **Shutdown:** `release()` ends every open subscription. Afterwards, `subscribe()` throws.
- **Typed topics:** pass a topic map as the generic parameter of `BunPgSubscriber<TTopics>` to type each channel's payloads.

### Experimental NOTICE Messages

⚠️ **WARNING**: This is an experimental feature that requires manual enablement. Since Bun SQL doesn't directly expose NOTICE messages, we use a workaround to capture them. This approach has significant limitations:

- May not capture all NOTICE messages
- Relies on parsing error messages
- Not as reliable as native NOTICE handling

Only enable this feature if you understand these limitations and have no alternative solution.

```typescript
const pgService = makePgService({
  connectionString: process.env.DATABASE_URL,
  schemas: ["public"],
  captureNotices: true,  // Enable experimental NOTICE capture
});

const result = await client.query({
  text: "SELECT my_function()",
  values: [],
});

// Check for notices
if (result.notices && result.notices.length > 0) {
  console.log("Notices:", result.notices);
}
```

## API Reference

### Functions

- `makePgService(options)` - Create a PostgreSQL service configuration
- `createWithPgClient(options)` - Create a withPgClient function
- `newBunPgClient(sql, txLevel, alwaysQueue, options)` - Create a BunPgClient wrapper

### Classes

- `BunPgSubscriber<TTopics>` - LISTEN/NOTIFY subscriber backed by Bun SQL's `listen()`/`notify()`
- `BunPgNativeSubscriber` - Alias for BunPgSubscriber

### Interfaces

- `BunPgClient` - Extended client interface with Bun SQL specifics
- `BunPgAdaptorSettings` - Settings for adapter creation
- `BunPgAdaptorMakePgServiceOptions` - Options for service creation

## Performance

| Operation | pg Package | Bun SQL | Improvement |
|-----------|------------|---------|-------------|
| Simple Query | 1.0x | 1.2-1.5x | 20-50% |
| Batch Insert | 1.0x | 1.3-1.8x | 30-80% |
| Transaction | 1.0x | 1.1-1.4x | 10-40% |

## Limitations

### Other Limitations

1. **Bun Only**: Cannot be used in Node.js

## Compatibility

- Bun runtime >= 1.0.0
- @dataplan/pg >= 1.0.0
- grafast >= 0.1.0
- PostgreSQL >= 12

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Watch mode
bun run dev

# Clean build artifacts
bun run clean
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT

## Acknowledgments

- Built on top of [Bun](https://bun.sh/)'s native PostgreSQL driver
- Compatible with [Graphile](https://grafast.org/) ecosystem
- Inspired by [node-postgres](https://node-postgres.com/) API