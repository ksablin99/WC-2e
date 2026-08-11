import {
  legacyAlignmentUpdate,
  parseLegacyAlignment,
} from "../../module/alignment-migration.js";

describe("legacy alignment migration", () => {
  it.each([
    ["Lawful Good", { mode: "axes", lawChaos: "l", goodEvil: "g" }],
    ["Always chaotic evil", { mode: "axes", lawChaos: "c", goodEvil: "e" }],
    ["Usually neutral", { mode: "axes", lawChaos: "n", goodEvil: "n" }],
    ["Any evil", { mode: "axes", lawChaos: "any", goodEvil: "e" }],
    ["Always chaotic (any)", { mode: "axes", lawChaos: "c", goodEvil: "any" }],
    ["None", { mode: "unaligned" }],
  ])("parses %s", (input, expected) => {
    expect(parseLegacyAlignment(input)).toEqual(expected);
  });

  it("builds actor update data for structured axes", () => {
    expect(legacyAlignmentUpdate({
      system: {
        details: {
          alignment: "Neutral Good",
          alignmentMode: "text",
        },
      },
    })).toEqual({
      "system.details.alignmentMode": "axes",
      "system.details.alignmentAxes": { lawChaos: "n", goodEvil: "g" },
      "system.details.actualAlignmentAxes": { lawChaos: "n", goodEvil: "g" },
    });
  });

  it("does not overwrite actors already using structured alignment", () => {
    expect(legacyAlignmentUpdate({
      system: {
        details: {
          alignment: "Lawful Good",
          alignmentMode: "axes",
          alignmentAxes: { lawChaos: "l", goodEvil: "g" },
        },
      },
    })).toEqual({});
  });

  it("keeps unknown alignment text in text mode", () => {
    expect(legacyAlignmentUpdate({
      system: {
        details: {
          alignment: "GM custom value",
          alignmentMode: "text",
        },
      },
    })).toEqual({});
  });
});
