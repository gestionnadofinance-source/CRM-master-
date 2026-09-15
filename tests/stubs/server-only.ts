// Stub for the "server-only" marker package used during Vitest runs.
//
// The real "server-only" package unconditionally throws when its default
// export is required, as a build-time guard that prevents server code from
// being bundled into a client component. That guard is meaningless (and
// actively harmful) inside a plain Node test run: the whole point of the
// integration tests in tests/ is to exercise the real server modules
// (src/server/**, src/lib/prisma.ts, etc.) directly against Postgres.
//
// vitest.config.ts aliases the "server-only" specifier to this empty module
// so importing any server-only file under test does not throw. This file is
// test infrastructure only — it is never bundled into the actual app, which
// still resolves "server-only" to the real npm package.
export {};
