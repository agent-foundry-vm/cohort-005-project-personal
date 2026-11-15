import { describe, it, expect } from "vitest";
import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { describeNoteDraft } from "../index";

const SAVED = {
  body: "Rewatch at 4:20",
  updatedAt: "2026-11-15T12:00:00.000Z",
};

describe("describeNoteDraft", () => {
  it("is blank, and cannot be saved, before the Student writes anything", () => {
    expect(describeNoteDraft("", null)).toEqual({
      length: 0,
      max: MAX_NOTE_LENGTH,
      tooLong: false,
      canSave: false,
      status: { kind: "blank" },
    });
  });

  it("cannot save a draft of only whitespace", () => {
    const draft = describeNoteDraft("   \n  ", null);
    expect(draft.canSave).toBe(false);
    expect(draft.length).toBe(0);
    expect(draft.status).toEqual({ kind: "blank" });
  });

  it("offers to save a new draft and counts its trimmed length", () => {
    const draft = describeNoteDraft("  Ask about generics  ", null);
    expect(draft.length).toBe("Ask about generics".length);
    expect(draft.canSave).toBe(true);
    expect(draft.status).toEqual({ kind: "unsaved" });
  });

  it("shows when the saved Note was last edited while the draft matches it", () => {
    const draft = describeNoteDraft(SAVED.body, SAVED);
    expect(draft.canSave).toBe(false);
    expect(draft.status).toEqual({ kind: "saved", updatedAt: SAVED.updatedAt });
  });

  it("treats added surrounding whitespace as no change, since saving trims", () => {
    const draft = describeNoteDraft(`  ${SAVED.body}\n`, SAVED);
    expect(draft.canSave).toBe(false);
    expect(draft.status.kind).toBe("saved");
  });

  it("marks an edit to the saved Note as unsaved", () => {
    const draft = describeNoteDraft(`${SAVED.body} and 7:10`, SAVED);
    expect(draft.canSave).toBe(true);
    expect(draft.status).toEqual({ kind: "unsaved" });
  });

  it("cannot clear a saved Note to nothing", () => {
    const draft = describeNoteDraft("", SAVED);
    expect(draft.canSave).toBe(false);
    expect(draft.status).toEqual({ kind: "unsaved" });
  });

  it("accepts a draft of exactly the maximum length", () => {
    const draft = describeNoteDraft("a".repeat(MAX_NOTE_LENGTH), null);
    expect(draft.tooLong).toBe(false);
    expect(draft.canSave).toBe(true);
  });

  it("blocks a draft over the maximum and says by how much", () => {
    const draft = describeNoteDraft("a".repeat(MAX_NOTE_LENGTH + 3), null);
    expect(draft.tooLong).toBe(true);
    expect(draft.canSave).toBe(false);
    expect(draft.status).toEqual({ kind: "too-long", over: 3 });
  });

  it("shows the error from the last save", () => {
    const draft = describeNoteDraft("Something", null, "Could not save");
    expect(draft.status).toEqual({ kind: "error", message: "Could not save" });
  });

  it("puts the length limit ahead of the error from the last save", () => {
    const draft = describeNoteDraft(
      "a".repeat(MAX_NOTE_LENGTH + 1),
      null,
      "Could not save"
    );
    expect(draft.status.kind).toBe("too-long");
  });
});
