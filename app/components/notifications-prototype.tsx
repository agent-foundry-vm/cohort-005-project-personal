// PROTOTYPE — wayfinder ticket #8 "Prototype the bell, inbox, toast and click-through".
// Throwaway. Lives only on the `prototype/notifications-ui` branch. Never merge.
//
// Three variants of the bell / inbox / click-through, mounted in the real app layout
// and switchable from the floating bar (← / →):
//   A  Dropdown → subject     bell in the sidebar header, popover list, click goes straight to the subject
//   B  Inbox → detail first   "Notifications" nav item, slide-over inbox with a detail pane (stands in for /notifications/:id)
//   C  Hybrid panel           top-right pill, grouped panel; row click goes to the subject, chevron expands detail inline
// The floating bar also toggles whether Comment Notifications (N3, N4) jump to the Comment (#comment-{id})
// or land on the top of the lesson, and can simulate an arrival.
//
// All state is in memory and resets on a full reload. Toasts follow the v1 rule: a Notification
// toasts on the first page load / navigation after it was created, once. A toast you ignore stays unread.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  MessageSquare,
  RefreshCw,
  Reply,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { PrototypeSwitcher } from "~/components/prototype-switcher";

type NType = "N1" | "N2" | "N3" | "N4" | "N5" | "N6";
export type RoleKey = "student" | "team-admin" | "instructor" | "admin" | "none";

interface Notif {
  id: number;
  type: NType;
  title: string;
  body: string;
  href: string;
  anchor?: string;
  subjectLabel: string;
  detail: string[];
  minutesAgo: number;
  read: boolean;
  toasted: boolean;
}

const TS_COURSE = "/courses/introduction-to-typescript";

type Seed = Omit<Notif, "id" | "read" | "toasted" | "minutesAgo">;

const N = {
  refundApprovedIndividual: {
    type: "N1",
    title: "Refund approved — Introduction to TypeScript",
    body: "$49.00, the full amount you paid, is on its way back to you.",
    href: "/settings",
    subjectLabel: "Purchase history",
    detail: ["Amount: $49.00", "Your Enrollment has ended.", "Approved by a Platform Admin."],
  },
  refundDeclinedIndividual: {
    type: "N2",
    title: "Refund declined — Design Systems with Tailwind",
    body: "You've completed more than half of the course. You still have everything you bought.",
    href: "/settings",
    subjectLabel: "Purchase history",
    detail: [
      "Platform Admin's note: You've completed more than half of the course, which is past our refund window. Happy to talk if something went wrong.",
    ],
  },
  refundApprovedTeam: {
    type: "N1",
    title: "Refund approved — Building REST APIs with Node.js",
    body: "$450.00, the full amount you paid, is on its way back to you.",
    href: "/team",
    subjectLabel: "Team",
    detail: ["Amount: $450.00 (Team Licence, 10 Seats)", "Approved by a Platform Admin."],
  },
  replyToMyComment: {
    type: "N3",
    title: "Sarah Chen replied to your comment",
    body: "That usually means TypeScript is installed locally but not on your PATH. Try running it with npx… on Your First TypeScript Program",
    href: `${TS_COURSE}/lessons/3`,
    anchor: "comment-2",
    subjectLabel: "Lesson",
    detail: [
      "Your comment: \"I'm getting `tsc: command not found` when I…\"",
      "Reply: \"That usually means TypeScript is installed locally but not on your PATH. Try running it with npx tsc instead.\"",
    ],
  },
  newCommentOnMyLesson: {
    type: "N4",
    title: "New comment on Arrays and Tuples",
    body: "Emma Wilson: Is there a reason to prefer `interface` over `type` for object shapes, or is it purely sty…",
    href: `${TS_COURSE}/lessons/5`,
    anchor: "comment-5",
    subjectLabel: "Lesson",
    detail: [
      "Course: Introduction to TypeScript",
      "Emma Wilson: \"Is there a reason to prefer `interface` over `type` for object shapes, or is it purely style?\"",
    ],
  },
  seatClaimed: {
    type: "N5",
    title: "Jordan Kim claimed a Seat — Building REST APIs with Node.js",
    body: "7 of 10 Seats claimed.",
    href: "/team",
    subjectLabel: "Team",
    detail: ["Claimed with the shared invite link.", "3 Seats left."],
  },
  allSeatsClaimed: {
    type: "N5",
    title: "Olivia Brown claimed a Seat — Building REST APIs with Node.js",
    body: "All 10 Seats are now claimed.",
    href: "/team",
    subjectLabel: "Team",
    detail: ["Your Team Licence is full. Buy more Seats from the Team page."],
  },
  statusChanged: {
    type: "N6",
    title: "Introduction to TypeScript is now Archived",
    body: "Changed by a Platform Admin.",
    href: "/instructor/1",
    subjectLabel: "Course editor",
    detail: ["Archived courses stay available to enrolled Students but can't be bought."],
  },
} satisfies Record<string, Seed>;

// [seed, minutesAgo, read, toasted]. toasted=false → toasts on the first load.
const SEEDS: Record<RoleKey, [Seed, number, boolean, boolean][]> = {
  student: [
    [N.replyToMyComment, 4, false, false],
    [N.refundApprovedIndividual, 180, false, true],
    [N.refundDeclinedIndividual, 60 * 26, true, true],
  ],
  "team-admin": [
    [N.allSeatsClaimed, 2, false, false],
    [N.seatClaimed, 95, false, true],
    [N.refundApprovedTeam, 60 * 50, true, true],
  ],
  instructor: [
    [N.newCommentOnMyLesson, 6, false, false],
    [N.replyToMyComment, 240, false, true],
    [N.statusChanged, 60 * 30, true, true],
  ],
  admin: [],
  none: [],
};

const ARRIVALS: Record<RoleKey, Seed[]> = {
  student: [N.replyToMyComment, N.refundDeclinedIndividual, N.refundApprovedIndividual],
  "team-admin": [N.seatClaimed, N.refundApprovedTeam],
  instructor: [N.newCommentOnMyLesson, N.statusChanged, N.replyToMyComment],
  admin: [],
  none: [],
};

// ---- in-memory store ---------------------------------------------------------

let state = { role: "none" as RoleKey, items: [] as Notif[], nextId: 1, arrivals: 0 };
const listeners = new Set<() => void>();
function set(next: typeof state) {
  state = next;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const getSnapshot = () => state;

function seed(role: RoleKey) {
  let id = 1;
  const items = SEEDS[role].map(([s, minutesAgo, read, toasted]) => ({
    ...s,
    id: id++,
    minutesAgo,
    read,
    toasted,
  }));
  set({ role, items, nextId: id, arrivals: 0 });
}
function markRead(id: number, read = true) {
  set({ ...state, items: state.items.map((n) => (n.id === id ? { ...n, read } : n)) });
}
function markAllRead() {
  set({ ...state, items: state.items.map((n) => ({ ...n, read: true })) });
}
function simulateArrival() {
  const pool = ARRIVALS[state.role];
  if (pool.length === 0) return;
  const s = pool[state.arrivals % pool.length];
  set({
    ...state,
    arrivals: state.arrivals + 1,
    nextId: state.nextId + 1,
    items: [{ ...s, id: state.nextId, minutesAgo: 0, read: false, toasted: false }, ...state.items],
  });
}
function takeUntoasted() {
  const pending = state.items.filter((n) => !n.toasted);
  if (pending.length) set({ ...state, items: state.items.map((n) => ({ ...n, toasted: true })) });
  return pending;
}

// ---- helpers -----------------------------------------------------------------

const ICONS: Record<NType, typeof Bell> = {
  N1: CheckCircle2,
  N2: XCircle,
  N3: Reply,
  N4: MessageSquare,
  N5: UserPlus,
  N6: RefreshCw,
};
const ICON_COLOURS: Record<NType, string> = {
  N1: "text-emerald-600",
  N2: "text-rose-600",
  N3: "text-sky-600",
  N4: "text-violet-600",
  N5: "text-amber-600",
  N6: "text-zinc-500",
};

function ago(m: number) {
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 60 / 24)}d ago`;
}

function TypeIcon({ type, className }: { type: NType; className?: string }) {
  const Icon = ICONS[type];
  return <Icon className={cn("size-4 shrink-0", ICON_COLOURS[type], className)} />;
}

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function AdminEmpty() {
  return (
    <div className="p-6 text-center text-sm text-muted-foreground">
      Platform Admins get no Notifications in v1. Their count of Open Refund Requests lives on
      Refund Requests (placement is the bell-placement question).
    </div>
  );
}

type Open = (n: Notif) => void;
interface VariantProps {
  items: Notif[];
  unread: number;
  open: Open;
  isAdmin: boolean;
}

// ---- Variant A: dropdown → straight to subject -----------------------------

function VariantABell({ items, unread, open, isAdmin }: VariantProps) {
  const [isOpen, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useOutsideClose(isOpen, close);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        title="Notifications"
      >
        <Bell className="size-4" />
        <CountBadge count={unread} className="absolute -right-1 -top-1" />
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {isAdmin ? (
            <AdminEmpty />
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">You're all caught up.</div>
          ) : (
            <ul className="max-h-[28rem] divide-y overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      close();
                      open(n);
                    }}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left hover:bg-accent",
                      !n.read && "bg-primary/5"
                    )}
                  >
                    <TypeIcon type={n.type} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{ago(n.minutesAgo)}</div>
                    </div>
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Variant B: inbox slide-over with a detail pane --------------------------

function VariantBNavItem({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Bell className="size-4" />
      Notifications
      <CountBadge count={unread} className="ml-auto h-5 min-w-5 text-[11px]" />
    </button>
  );
}

function VariantBInbox({
  items,
  open,
  isAdmin,
  onClose,
}: VariantProps & { onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(items[0]?.id ?? null);
  const selected = items.find((n) => n.id === selectedId) ?? null;
  const ref = useOutsideClose(true, onClose);

  useEffect(() => {
    if (selected && !selected.read) markRead(selected.id);
  }, [selected?.id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/30">
      <div
        ref={ref}
        className="absolute inset-y-0 right-0 flex w-[760px] max-w-full flex-col bg-background shadow-2xl"
      >
        <div className="flex h-14 items-center justify-between border-b px-5">
          <div>
            <div className="font-semibold">Notifications</div>
            <div className="text-[11px] text-muted-foreground">
              Stands in for a dedicated <code>/notifications</code> + <code>/notifications/:id</code> page
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={markAllRead} className="text-xs text-primary hover:underline">
              Mark all read
            </button>
            <button onClick={onClose} className="rounded-md p-1 hover:bg-accent">
              <X className="size-4" />
            </button>
          </div>
        </div>
        {isAdmin ? (
          <AdminEmpty />
        ) : (
          <div className="flex min-h-0 flex-1">
            <ul className="w-72 shrink-0 divide-y overflow-y-auto border-r">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => setSelectedId(n.id)}
                    className={cn(
                      "flex w-full gap-2 px-4 py-3 text-left hover:bg-accent",
                      n.id === selectedId && "bg-accent"
                    )}
                  >
                    {!n.read ? (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    ) : (
                      <span className="size-2 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className={cn("truncate text-sm", !n.read && "font-semibold")}>{n.title}</div>
                      <div className="text-[11px] text-muted-foreground">{ago(n.minutesAgo)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex-1 overflow-y-auto p-8">
              {selected ? (
                <div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <TypeIcon type={selected.type} />
                    {selected.type} · {ago(selected.minutesAgo)}
                  </div>
                  <h2 className="mt-3 text-xl font-semibold">{selected.title}</h2>
                  <p className="mt-2 text-muted-foreground">{selected.body}</p>
                  <div className="mt-6 space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
                    {selected.detail.map((d) => (
                      <p key={d}>{d}</p>
                    ))}
                  </div>
                  <div className="mt-6 flex gap-2">
                    <button
                      onClick={() => {
                        onClose();
                        open(selected);
                      }}
                      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Open {selected.subjectLabel.toLowerCase()} →
                    </button>
                    <button
                      onClick={() => markRead(selected.id, false)}
                      className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                    >
                      Mark unread
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">You're all caught up.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Variant C: top-right pill, grouped panel, inline expand -----------------

function VariantC({ items, unread, open, isAdmin }: VariantProps) {
  const [isOpen, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const close = () => setOpen(false);
  const ref = useOutsideClose(isOpen, close);

  const shown = tab === "unread" ? items.filter((n) => !n.read) : items;
  const groups: [string, Notif[]][] = [
    ["Today", shown.filter((n) => n.minutesAgo < 60 * 24)],
    ["Earlier", shown.filter((n) => n.minutesAgo >= 60 * 24)],
  ];

  return (
    <div ref={ref} className="fixed right-5 top-3 z-40">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm shadow-sm hover:bg-accent",
          unread > 0 && "border-primary/40"
        )}
      >
        <Bell className={cn("size-4", unread > 0 && "text-primary")} />
        {unread > 0 ? <span className="font-medium">{unread} new</span> : <span>Inbox</span>}
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 flex max-h-[80vh] w-[440px] flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl">
          <div className="flex items-center gap-1 border-b px-3 py-2">
            {(["all", "unread"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium capitalize",
                  tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                )}
              >
                {t}
                {t === "unread" && unread > 0 && ` (${unread})`}
              </button>
            ))}
            <button onClick={markAllRead} className="ml-auto text-xs text-primary hover:underline">
              Mark all read
            </button>
          </div>
          {isAdmin ? (
            <AdminEmpty />
          ) : (
            <div className="overflow-y-auto">
              {shown.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">Nothing unread.</div>
              )}
              {groups.map(
                ([label, list]) =>
                  list.length > 0 && (
                    <div key={label}>
                      <div className="sticky top-0 bg-muted/80 px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                        {label}
                      </div>
                      {list.map((n) => (
                        <div key={n.id} className="border-b last:border-b-0">
                          <div className="flex items-start gap-3 px-4 py-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                              <TypeIcon type={n.type} />
                            </div>
                            <button
                              onClick={() => {
                                close();
                                open(n);
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className={cn("text-sm hover:underline", !n.read && "font-semibold")}>
                                {n.title}
                              </div>
                              <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{n.body}</div>
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                {!n.read && <span className="size-1.5 rounded-full bg-primary" />}
                                {ago(n.minutesAgo)} · {n.subjectLabel}
                              </div>
                            </button>
                            <button
                              onClick={() => {
                                setExpanded(expanded === n.id ? null : n.id);
                                if (!n.read) markRead(n.id);
                              }}
                              className="rounded p-1 text-muted-foreground hover:bg-accent"
                              title="Show details"
                            >
                              <ChevronDown
                                className={cn("size-4 transition-transform", expanded === n.id && "rotate-180")}
                              />
                            </button>
                          </div>
                          {expanded === n.id && (
                            <div className="mx-4 mb-3 ml-15 space-y-1.5 rounded-md bg-muted/50 p-3 text-xs">
                              {n.detail.map((d) => (
                                <p key={d}>{d}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- wiring ------------------------------------------------------------------

const VARIANTS = [
  { key: "A", name: "Dropdown → subject" },
  { key: "B", name: "Inbox → detail first" },
  { key: "C", name: "Hybrid panel" },
];

function useStoredFlag<T extends string>(key: string, param: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get(param) as T | null;
    const stored = localStorage.getItem(key) as T | null;
    setValue(fromUrl ?? stored ?? fallback);
  }, []);
  function update(v: T) {
    setValue(v);
    localStorage.setItem(key, v);
    const url = new URL(window.location.href);
    url.searchParams.set(param, v);
    window.history.replaceState(window.history.state, "", url);
  }
  return [value, update] as const;
}

export function useNotificationsPrototype(role: RoleKey) {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [variant, setVariant] = useStoredFlag<string>("proto-notif-variant", "variant", "A");
  const [anchor, setAnchor] = useStoredFlag<"on" | "off">("proto-notif-anchor", "anchor", "on");
  const [inboxOpen, setInboxOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Reseed whenever the DevUI switches user (must run before the toast effect below).
  useEffect(() => {
    if (state.role !== role) seed(role);
  }, [role]);

  const items = s.role === role ? s.items : [];
  const unread = items.filter((n) => !n.read).length;
  const pendingToasts = items.filter((n) => !n.toasted).length;

  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  function open(n: Notif) {
    markRead(n.id);
    const hash = anchorRef.current === "on" && n.anchor ? `#${n.anchor}` : "";
    navigate(n.href + hash);
  }

  // v1 rule: toast once, on the first page load / navigation after creation.
  useEffect(() => {
    for (const n of takeUntoasted()) {
      toast(n.title, {
        description: n.body,
        icon: <TypeIcon type={n.type} />,
        duration: 8000,
        action: { label: "View", onClick: () => open(n) },
      });
    }
  }, [location.key, role]);

  // Deep link to a Comment: scroll to it and flash it.
  useEffect(() => {
    if (!location.hash.startsWith("#comment-")) return;
    const t = setTimeout(() => {
      const el = document.getElementById(location.hash.slice(1));
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("bg-primary/10", "ring-2", "ring-primary/40");
      setTimeout(() => el.classList.remove("bg-primary/10", "ring-2", "ring-primary/40"), 2500);
    }, 100);
    return () => clearTimeout(t);
  }, [location.key]);

  const props: VariantProps = { items, unread, open, isAdmin: role === "admin" };

  const headerSlot = variant === "A" && role !== "none" ? <VariantABell {...props} /> : null;
  const navSlot =
    variant === "B" && role !== "none" ? (
      <VariantBNavItem unread={unread} onClick={() => setInboxOpen(true)} />
    ) : null;

  const overlay = (
    <>
      {variant === "B" && inboxOpen && <VariantBInbox {...props} onClose={() => setInboxOpen(false)} />}
      {variant === "C" && role !== "none" && <VariantC {...props} />}
      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={setVariant}>
        <span className="h-5 w-px bg-white/20" />
        <button
          onClick={() => setAnchor(anchor === "on" ? "off" : "on")}
          className="rounded-full px-2 py-0.5 text-xs hover:bg-white/10"
          title="Do Comment Notifications jump to the Comment, or the top of the lesson?"
        >
          Comment links: <b>{anchor === "on" ? "#comment" : "top of lesson"}</b>
        </button>
        <button
          onClick={simulateArrival}
          className="rounded-full bg-white/10 px-2 py-0.5 text-xs hover:bg-white/20"
          title="Creates a Notification now. Per v1 it toasts on your next navigation."
        >
          + Simulate arrival
        </button>
        <span className="text-[11px] text-white/60">
          {unread} unread · {pendingToasts} toast{pendingToasts === 1 ? "" : "s"} waiting for next nav
        </span>
      </PrototypeSwitcher>
    </>
  );

  return { headerSlot, navSlot, overlay };
}
