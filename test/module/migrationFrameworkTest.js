import {
  createMigrationState,
  getPendingMigrations,
  markMigrationCompleted,
  markMigrationSkipped,
  normalizeMigrationState,
} from "../../module/migration-framework.js";

const migrations = [
  { id: "legacy-3-0-1", version: "3.0.1" },
  { id: "future-3-0-3", version: "3.0.3" },
  { id: "optional-3-0-3", version: "3.0.3", optional: true },
];

describe("migration framework", () => {
  it("skips legacy migrations for a fresh 3.0.2 world", () => {
    const state = createMigrationState({
      legacyVersion: "0.0.0",
      worldSystemVersion: "3.0.2",
      currentSystemVersion: "3.0.2",
    });

    expect(getPendingMigrations(migrations, state).map((m) => m.id)).toEqual([]);
  });

  it("runs future 3.0.3 migrations for a world already migrated through 3.0.2", () => {
    const state = createMigrationState({
      legacyVersion: "3.0.2",
      worldSystemVersion: "3.0.2",
      currentSystemVersion: "3.0.3",
    });

    expect(getPendingMigrations(migrations, state).map((m) => m.id)).toEqual(["future-3-0-3", "optional-3-0-3"]);
  });

  it("runs legacy migrations for a world older than 3.0.2", () => {
    const state = createMigrationState({
      legacyVersion: "0.0.0",
      worldSystemVersion: "3.0.0-beta.2",
      currentSystemVersion: "3.0.3",
    });

    expect(getPendingMigrations(migrations, state).map((m) => m.id)).toEqual([
      "legacy-3-0-1",
      "future-3-0-3",
      "optional-3-0-3",
    ]);
  });

  it("uses existing legacy migration version as baseline", () => {
    const state = createMigrationState({
      legacyVersion: "3.0.1",
      worldSystemVersion: "3.0.0",
      currentSystemVersion: "3.0.3",
    });

    expect(getPendingMigrations(migrations, state).map((m) => m.id)).toEqual(["future-3-0-3", "optional-3-0-3"]);
  });

  it("does not rerun completed migrations", () => {
    const state = normalizeMigrationState({
      baselineVersion: "3.0.0",
      currentSystemVersion: "3.0.3",
      lastSuccessVersion: "3.0.0",
      completed: {
        "legacy-3-0-1": { version: "3.0.1", completedAt: "2026-01-01T00:00:00.000Z" },
      },
    });

    expect(getPendingMigrations(migrations, state).map((m) => m.id)).toEqual(["future-3-0-3", "optional-3-0-3"]);
  });

  it("advances last successful version when a migration completes", () => {
    const state = createMigrationState({
      worldSystemVersion: "3.0.0",
      currentSystemVersion: "3.0.3",
    });
    const next = markMigrationCompleted(state, migrations[0], "2026-01-01T00:00:00.000Z", {
      affected: { byType: { Actor: 2, Item: 1 } },
    });

    expect(next.completed["legacy-3-0-1"].version).toBe("3.0.1");
    expect(next.lastSuccessVersion).toBe("3.0.1");
    expect(next.completed["legacy-3-0-1"].affected).toEqual({
      total: 3,
      byType: { Actor: 2, Item: 1 },
    });
  });

  it("does not rerun skipped optional migrations", () => {
    const state = createMigrationState({
      legacyVersion: "3.0.2",
      worldSystemVersion: "3.0.2",
      currentSystemVersion: "3.0.3",
    });
    const next = markMigrationSkipped(state, migrations[2], "2026-01-01T00:00:00.000Z", "test");

    expect(next.skipped["optional-3-0-3"].version).toBe("3.0.3");
    expect(getPendingMigrations(migrations, next).map((m) => m.id)).toEqual(["future-3-0-3"]);
  });
});
