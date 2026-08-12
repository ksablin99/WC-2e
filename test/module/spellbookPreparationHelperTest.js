import {
  getRepertoirePreparedLimit,
  getSpellbookPreparationMode,
  getSpellbookRepertoireLimit,
  isSpellPreparedForSpellbook,
  SPELLBOOK_PREPARATION_MODE_PREPARED,
  SPELLBOOK_PREPARATION_MODE_REPERTOIRE,
  SPELLBOOK_PREPARATION_MODE_SPONTANEOUS,
  spellbookUsesSharedSlots,
} from "../../module/item/helpers/spellbookPreparationHelper.js";

describe("Warcraft spellbook preparation", () => {
  describe("mode resolution", () => {
    it("preserves legacy spontaneous and prepared spellbooks", () => {
      expect(getSpellbookPreparationMode({ spontaneous: true })).toBe(SPELLBOOK_PREPARATION_MODE_SPONTANEOUS);
      expect(getSpellbookPreparationMode({ spontaneous: false })).toBe(SPELLBOOK_PREPARATION_MODE_PREPARED);
      expect(getSpellbookPreparationMode({})).toBe(SPELLBOOK_PREPARATION_MODE_PREPARED);
      expect(getSpellbookPreparationMode(null)).toBe(SPELLBOOK_PREPARATION_MODE_PREPARED);
    });

    it("prefers an explicit valid mode over the legacy flag", () => {
      expect(getSpellbookPreparationMode({ preparationMode: "repertoire", spontaneous: false })).toBe(
        SPELLBOOK_PREPARATION_MODE_REPERTOIRE
      );
      expect(getSpellbookPreparationMode({ preparationMode: "prepared", spontaneous: true })).toBe(
        SPELLBOOK_PREPARATION_MODE_PREPARED
      );
    });

    it("uses shared per-level slots only for spontaneous and repertoire modes", () => {
      expect(spellbookUsesSharedSlots({ preparationMode: "repertoire" })).toBe(true);
      expect(spellbookUsesSharedSlots({ spontaneous: true })).toBe(true);
      expect(spellbookUsesSharedSlots({ preparationMode: "prepared" })).toBe(false);
      expect(spellbookUsesSharedSlots(null)).toBe(false);
    });

    it("gates only unprepared spells in repertoire mode", () => {
      expect(isSpellPreparedForSpellbook({ preparation: { prepared: false } }, { preparationMode: "repertoire" })).toBe(
        false
      );
      expect(isSpellPreparedForSpellbook({ preparation: { prepared: true } }, { preparationMode: "repertoire" })).toBe(
        true
      );
      expect(isSpellPreparedForSpellbook({ preparation: { prepared: false } }, { preparationMode: "prepared" })).toBe(
        true
      );
      expect(isSpellPreparedForSpellbook(null, { preparationMode: "repertoire" })).toBe(false);
    });
  });

  describe("prepared repertoire limit", () => {
    it.each([
      [9, 0],
      [10, 3],
      [12, 3],
      [13, 5],
      [14, 5],
      [15, 7],
      [16, 7],
      [17, 9],
      [18, 9],
      [19, 11],
      [20, 11],
      [21, 13],
      [30, 13],
    ])("gives an ability score of %i a base limit of %i", (score, expected) => {
      expect(getRepertoirePreparedLimit(score)).toBe(expected);
    });

    it("adds one prepared spell for every four full Spellcraft ranks", () => {
      expect(getRepertoirePreparedLimit(10, 3)).toBe(3);
      expect(getRepertoirePreparedLimit(10, 4)).toBe(4);
      expect(getRepertoirePreparedLimit(10, 8)).toBe(5);
      expect(getRepertoirePreparedLimit(10, -4)).toBe(3);
    });

    it("reads the configured base ability and ignores temporary total-score increases", () => {
      const actorSystem = {
        abilities: { int: { value: 10, total: 14 }, cha: { value: 17, total: 21 } },
        skills: { spl: { rank: 0 }, kno: { rank: 8 } },
      };

      expect(getSpellbookRepertoireLimit(actorSystem, { ability: "cha", repertoireSkill: "kno" })).toBe(11);
      expect(getSpellbookRepertoireLimit(actorSystem, {})).toBe(3);
      expect(getSpellbookRepertoireLimit(null, null)).toBe(0);
    });

    it("accepts a source-stated monster repertoire limit", () => {
      expect(getSpellbookRepertoireLimit({}, { repertoireLimitOverride: 18 })).toBe(18);
      expect(getSpellbookRepertoireLimit({}, { repertoireLimitOverride: 0 })).toBe(0);
    });
  });
});
