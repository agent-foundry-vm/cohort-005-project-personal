import { z } from "zod";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

/**
 * The body the server accepts. It sits beside `describeNoteDraft` so the
 * editor's trim, empty and length rules change with the server's.
 */
export const saveNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write something before saving your note.")
    .max(
      MAX_NOTE_LENGTH,
      `Your note is over ${MAX_NOTE_LENGTH.toLocaleString("en")} characters, so it was not saved.`
    ),
});

export type SavedNote = { body: string; updatedAt: string };

/** What the note editor shows under the text box, most urgent first. */
export type NoteStatus =
  | { kind: "too-long"; over: number }
  | { kind: "error"; message: string }
  | { kind: "emptied" }
  | { kind: "unsaved" }
  | { kind: "saved"; updatedAt: string }
  | { kind: "blank" };

export type NoteDraft = {
  length: number;
  max: number;
  tooLong: boolean;
  canSave: boolean;
  status: NoteStatus;
};

/**
 * Reads the Student's draft against the Note they last saved. Lengths and the
 * unsaved check use the trimmed body, because `saveNote` trims before it
 * checks and stores, so trailing spaces are never a change worth saving.
 */
export function describeNoteDraft(
  draft: string,
  saved: SavedNote | null,
  saveError?: string
): NoteDraft {
  const body = draft.trim();
  const length = body.length;
  const tooLong = length > MAX_NOTE_LENGTH;
  const unsaved = body !== (saved?.body ?? "");

  return {
    length,
    max: MAX_NOTE_LENGTH,
    tooLong,
    canSave: unsaved && length > 0 && !tooLong,
    status: noteStatus(),
  };

  function noteStatus(): NoteStatus {
    if (tooLong) return { kind: "too-long", over: length - MAX_NOTE_LENGTH };
    if (saveError) return { kind: "error", message: saveError };
    if (unsaved && length === 0) return { kind: "emptied" };
    if (unsaved) return { kind: "unsaved" };
    if (saved) return { kind: "saved", updatedAt: saved.updatedAt };
    return { kind: "blank" };
  }
}
