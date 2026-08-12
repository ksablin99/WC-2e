const numeric = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const storedInvestment = (skill = {}) => numeric(skill.points ?? skill.rank);

/**
 * Merge legacy Hide and Move Silently into Warcraft's single Stealth skill.
 *
 * We retain the greater investment rather than summing both skills. Summing
 * would double the maximum attainable rank. The lower investment is reported
 * as refundable points, and both source records are retained in the backup.
 */
export function mergeLegacyStealthSkills(skills = {}) {
  const hide = skills.hid;
  const moveSilently = skills.mos;
  if (!moveSilently) return { changed: false, skills };

  const hideInvestment = storedInvestment(hide);
  const moveInvestment = storedInvestment(moveSilently);
  const mergedInvestment = Math.max(hideInvestment, moveInvestment);
  const merged = {
    ...(hide ?? moveSilently),
    // `points` is authoritative in the current actor model. Legacy actors may
    // only have `rank`, so use the greater normalized investment for both.
    points: mergedInvestment,
    rank: mergedInvestment,
  };

  return {
    changed: true,
    skills: { ...skills, hid: merged, mos: undefined },
    backup: {
      policy: "higher-investment-with-refund-report",
      hide: hide ? clone(hide) : null,
      moveSilently: clone(moveSilently),
      mergedInvestment,
      refundableInvestment: Math.min(hideInvestment, moveInvestment),
    },
  };
}

/** Apply the same merge to every stored level-up row. */
export function mergeLegacyStealthLevelRows(rows = []) {
  let changed = false;
  let refundableInvestment = 0;
  const backups = [];
  const levelUpData = rows.map((row, index) => {
    const result = mergeLegacyStealthSkills(row?.skills ?? {});
    if (!result.changed) return row;
    changed = true;
    refundableInvestment += result.backup.refundableInvestment;
    backups.push({ index, ...result.backup });
    const skills = { ...result.skills };
    delete skills.mos;
    return { ...row, skills };
  });
  return { changed, levelUpData, backups, refundableInvestment };
}

/** Build a reversible Foundry update for one actor-like source object. */
export function buildStealthMigrationUpdate(actorLike) {
  const system = actorLike?.system ?? actorLike?.data?.data ?? {};
  const currentBackup = actorLike?.flags?.warcraftrpg2e?.migrations?.stealth;
  if (currentBackup) return {};

  const skillResult = mergeLegacyStealthSkills(system.skills ?? {});
  const levelResult = mergeLegacyStealthLevelRows(system.details?.levelUpData ?? []);
  if (!skillResult.changed && !levelResult.changed) return {};

  const update = {};
  if (skillResult.changed) {
    update["system.skills.hid"] = skillResult.skills.hid;
    update["system.skills.-=mos"] = null;
  }
  if (levelResult.changed) update["system.details.levelUpData"] = levelResult.levelUpData;
  update["flags.warcraftrpg2e.migrations.stealth"] = {
    version: 1,
    actorSkills: skillResult.backup ?? null,
    levelRows: levelResult.backups,
    refundableInvestment:
      (skillResult.backup?.refundableInvestment ?? 0) + levelResult.refundableInvestment,
  };
  return update;
}
