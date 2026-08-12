import {
  buildStealthMigrationUpdate,
  mergeLegacyStealthLevelRows,
  mergeLegacyStealthSkills,
} from "../../module/actor/helpers/warcraftStealthMigration.js";

describe("Warcraft Stealth migration", () => {
  const hide = { points: 7, rank: 5, ability: "dex", acp: true };
  const moveSilently = { points: 4, rank: 4, ability: "dex", acp: true };

  it("does nothing to an already converted skill map", () => {
    expect(mergeLegacyStealthSkills({ hid: hide })).toEqual({ changed: false, skills: { hid: hide } });
  });

  it("keeps the greater investment, backs up both skills, and reports the lower investment", () => {
    const result = mergeLegacyStealthSkills({ hid: hide, mos: moveSilently });
    expect(result.skills.hid).toMatchObject({ points: 7, rank: 7, ability: "dex", acp: true });
    expect(result.skills.mos).toBeUndefined();
    expect(result.backup).toMatchObject({
      policy: "higher-investment-with-refund-report",
      mergedInvestment: 7,
      refundableInvestment: 4,
      hide,
      moveSilently,
    });
  });

  it("migrates stored level-up rows without mutating the source", () => {
    const rows = [{ level: 1, skills: { hid: hide, mos: moveSilently } }];
    const result = mergeLegacyStealthLevelRows(rows);
    expect(result.levelUpData[0].skills).toMatchObject({ hid: { points: 7, rank: 7 } });
    expect(result.levelUpData[0].skills.mos).toBeUndefined();
    expect(rows[0].skills.mos).toBe(moveSilently);
  });

  it("builds a reversible Foundry update and will not run twice", () => {
    const actor = {
      system: { skills: { hid: hide, mos: moveSilently }, details: { levelUpData: [] } },
      flags: {},
    };
    const update = buildStealthMigrationUpdate(actor);
    expect(update["system.skills.-=mos"]).toBeNull();
    expect(update["flags.warcraftrpg2e.migrations.stealth"]).toMatchObject({
      version: 1,
      refundableInvestment: 4,
    });

    expect(
      buildStealthMigrationUpdate({
        ...actor,
        flags: { warcraftrpg2e: { migrations: { stealth: update["flags.warcraftrpg2e.migrations.stealth"] } } },
      })
    ).toEqual({});
  });

  it("normalizes rank-only legacy records without mixing rank and points", () => {
    const result = mergeLegacyStealthSkills({
      hid: { rank: 3, ability: "dex" },
      mos: { points: 5, rank: 2, ability: "dex" },
    });
    expect(result.skills.hid).toMatchObject({ points: 5, rank: 5 });
    expect(result.backup.refundableInvestment).toBe(3);
  });
});
