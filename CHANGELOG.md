# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Failed queries threw a `TypeError` instead of the PostgreSQL error, because `Bun.SQLPostgresError` is undefined at runtime; now uses `Bun.SQL.PostgresError`
- `withPgClient` with `pgSettings` discarded the value returned by the transaction callback

### Added
- Unit tests (with fake Bun SQL handles) and integration tests against PostgreSQL (run with `DATABASE_URL`), bringing `src/` to 100% line and function coverage

### Changed
- LISTEN/NOTIFY (Pub/Sub) is no longer experimental: `BunPgSubscriber` now uses Bun SQL's native `listen()` and `notify()` instead of table polling
- **Breaking:** removed the polling-only `subscriberOptions` (`pollInterval`, `tableName`, `autoCreateTable`, `messageRetention`); no notification table is created anymore

## [1.0.0] - 2024-11-26

### Added
- Initial release of @dataplan/pg-bun
- Full compatibility with @dataplan/pg interface
- Bun SQL native driver integration
- High-performance query execution (20-80% faster than pg)
- Complete transaction support including savepoints
- Connection pooling with automatic management
- LISTEN/NOTIFY support via polling mechanism
- Experimental NOTICE message capture
- TypeScript support with comprehensive type definitions
- Comprehensive documentation and examples

### Features
- **Performance**: Leveraging Bun's native PostgreSQL driver
- **Transactions**: Full ACID compliance with nested transactions
- **Pub/Sub**: Polling-based notification system
- **NOTICE Capture**: Experimental support from errors and session state
- **Connection Management**: Automatic pool handling with reserve/release
- **Array Mode**: Support for array-based query results
- **pgSettings**: Session-level and transaction-level settings

### Compatibility
- Bun runtime >= 1.0.0
- @dataplan/pg >= 1.0.0
- grafast >= 0.1.0
- PostgreSQL >= 12

### Documentation
- Comprehensive README with usage examples
- API reference documentation
- Performance benchmarks
- Migration guide from pg adapter
- Contributing guidelines