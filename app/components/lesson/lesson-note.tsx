import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { Lock, NotebookPen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { LessonSection } from "~/components/lesson-section";
import { cn, formatRelativeTime } from "~/lib/utils";
import {
  describeNoteDraft,
  type NoteStatus,
  type SavedNote,
} from "~/modules/lesson-notes";

export function LessonNote({ note }: { note: SavedNote | null }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [body, setBody] = useState(note?.body ?? "");
  const isSaving = fetcher.state !== "idle";
  const draft = describeNoteDraft(body, note, fetcher.data?.error);

  return (
    <LessonSection
      icon={NotebookPen}
      title="Your notes"
      aside={<PrivateBadge />}
    >
      <fetcher.Form method="post" className="space-y-2">
        <input type="hidden" name="intent" value="save-note" />
        <Textarea
          name="body"
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Jot down what you want to remember from this lesson..."
          aria-label="Your notes on this lesson"
          className="resize-y"
        />

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={isSaving || !draft.canSave}>
            {isSaving ? "Saving..." : "Save note"}
          </Button>
          <NoteStatusText status={draft.status} />
          <span
            className={cn(
              "ml-auto text-xs",
              draft.tooLong ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {draft.length} / {draft.max}
          </span>
        </div>

        <NoteFooter />
      </fetcher.Form>
    </LessonSection>
  );
}

function NoteStatusText({ status }: { status: NoteStatus }) {
  switch (status.kind) {
    case "too-long":
      return (
        <span className="text-xs text-destructive">
          {status.over.toLocaleString("en")} characters over the limit
        </span>
      );
    case "error":
      return <span className="text-xs text-destructive">{status.message}</span>;
    case "unsaved":
      return (
        <span className="text-xs text-muted-foreground">Unsaved changes</span>
      );
    case "saved":
      return (
        <span
          suppressHydrationWarning
          className="text-xs text-muted-foreground"
        >
          Saved {formatRelativeTime(status.updatedAt)}
        </span>
      );
    case "blank":
      return null;
  }
}

function PrivateBadge() {
  return (
    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Lock className="size-3" />
      Private
    </span>
  );
}

function NoteFooter() {
  return (
    <p className="text-xs text-muted-foreground">
      Only you can read your notes. Find them all on your{" "}
      <Link to="/saved" className="underline hover:text-foreground">
        Saved
      </Link>{" "}
      page.
    </p>
  );
}
