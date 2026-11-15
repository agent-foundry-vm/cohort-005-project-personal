import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "~/components/ui/card";

/**
 * The card every section under a lesson's video sits in, so the Student's
 * notes and the discussion read as parts of one page.
 */
export function LessonSection({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="mb-8 gap-0 py-0">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Icon className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">{title}</h2>
          {aside && <div className="ml-auto">{aside}</div>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
