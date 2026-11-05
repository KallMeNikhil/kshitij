import { describe, expect, it } from "vitest";
import { decodeFields, encodeFields } from "../src/firestore/values";

describe("firestore value codec", () => {
  it("round-trips a flat document", () => {
    const original = { name: "Football", displayOrder: 1, active: true, tag: null };
    const decoded = decodeFields(encodeFields(original));
    expect(decoded).toEqual(original);
  });

  it("round-trips arrays and nested maps", () => {
    const original = {
      sportIds: ["FOOTBALL", "CRICKET"],
      slotA: { kind: "PARTICIPANT", participantId: "p1" },
      penalties: { a: 3, b: 4.5 },
    };
    const decoded = decodeFields(encodeFields(original));
    expect(decoded).toEqual(original);
  });

  it("omits undefined values", () => {
    const encoded = encodeFields({ a: 1, b: undefined });
    expect(Object.keys(encoded)).toEqual(["a"]);
  });

  it("preserves integer vs double distinction", () => {
    const encoded = encodeFields({ whole: 5, fractional: 5.5 });
    expect(encoded.whole).toEqual({ integerValue: "5" });
    expect(encoded.fractional).toEqual({ doubleValue: 5.5 });
  });
});

describe("firestore value decoding of console-created types", () => {
  it("keeps timestamps and references instead of dropping them", () => {
    const decoded = decodeFields({ createdAt: { timestampValue: "2026-10-01T00:00:00Z" }, ref: { referenceValue: "projects/p/databases/(default)/documents/a/b" } });
    expect(decoded).toEqual({ createdAt: "2026-10-01T00:00:00Z", ref: "projects/p/databases/(default)/documents/a/b" });
  });
});
