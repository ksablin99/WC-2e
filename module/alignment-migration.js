const LC_WORDS = new Map([
  ["lawful", "l"],
  ["chaotic", "c"],
]);

const GE_WORDS = new Map([
  ["good", "g"],
  ["evil", "e"],
]);

const PREFIX_WORDS = new Set(["always", "usually", "often"]);

export const parseLegacyAlignment = function(alignment) {
  if (typeof alignment !== "string") return null;

  const original = alignment.trim();
  if (!original) return null;

  const text = original.toLowerCase().replace(/[()]/g, " ");
  const words = text.split(/[^a-z]+/).filter(Boolean).filter((word) => !PREFIX_WORDS.has(word));
  if (!words.length) return null;

  if (words.length === 1 && words[0] === "none") return { mode: "unaligned" };
  if (words.length === 1 && words[0] === "neutral") {
    return { mode: "axes", lawChaos: "n", goodEvil: "n" };
  }

  let lawChaos = null;
  let goodEvil = null;
  let sawAlignmentWord = false;

  for (const word of words) {
    if (word === "any") {
      if (!lawChaos) lawChaos = "any";
      if (!goodEvil) goodEvil = "any";
      sawAlignmentWord = true;
      continue;
    }
    if (word === "neutral") {
      if (!lawChaos) lawChaos = "n";
      else if (!goodEvil) goodEvil = "n";
      sawAlignmentWord = true;
      continue;
    }
    if (LC_WORDS.has(word)) {
      lawChaos = LC_WORDS.get(word);
      sawAlignmentWord = true;
      continue;
    }
    if (GE_WORDS.has(word)) {
      goodEvil = GE_WORDS.get(word);
      sawAlignmentWord = true;
    }
  }

  if (!sawAlignmentWord) return null;
  return {
    mode: "axes",
    lawChaos: lawChaos ?? "any",
    goodEvil: goodEvil ?? "any",
  };
};

export const legacyAlignmentUpdate = function(actor) {
  const details = actor?.system?.details ?? actor?.data?.data?.details ?? actor?.data?.details;
  if (!details) return {};
  if (details.alignmentMode && details.alignmentMode !== "text") return {};

  const parsed = parseLegacyAlignment(details.alignment);
  if (!parsed) return {};

  if (parsed.mode === "unaligned") {
    return {
      "system.details.alignmentMode": "unaligned",
      "system.details.alignmentAxes": { lawChaos: "", goodEvil: "" },
      "system.details.actualAlignmentAxes": { lawChaos: "", goodEvil: "" },
    };
  }

  const axes = {
    lawChaos: parsed.lawChaos,
    goodEvil: parsed.goodEvil,
  };
  return {
    "system.details.alignmentMode": "axes",
    "system.details.alignmentAxes": axes,
    "system.details.actualAlignmentAxes": axes,
  };
};
