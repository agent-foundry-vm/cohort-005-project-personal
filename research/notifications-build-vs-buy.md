# Research: build vs. buy for in-app Notifications

Ticket: [#5](https://github.com/agent-foundry-vm/cohort-005-project-personal/issues/5) (map [#4](https://github.com/agent-foundry-vm/cohort-005-project-personal/issues/4)).
All sources were accessed on **2026-11-12**. This document gathers facts only. It does not make the build/buy decision, which belongs to a separate grilling ticket.

## Constraints these options are measured against

- One server process and one SQLite file, opened with synchronous `better-sqlite3` and queried through Drizzle ([ADR 0006](../docs/adr/0006-one-sqlite-file-through-drizzle.md)).
- React Router v8 (`react-router` 8.3.0 in `package.json`) server loaders. `sonner` is already used for toasts.
- Email goes through `app/lib/mailer.server.ts`. It holds a `MailTransport` interface with two transports: `postmarkTransport` (a direct `fetch` to `https://api.postmarkapp.com/email`, `MessageStream: "outbound"`) and `outboxTransport` (writes JSON files to `.outbox/` for dev and tests).
- v1 delivers on the next page load or navigation only. There is no live delivery and no new infrastructure.
- Scale is hundreds to low thousands of recipients.

---

## 1. Homegrown: a Drizzle table plus loaders

This option is described from the codebase itself. It needs no vendor sources.

- **Inbox model.** We define it. A typical shape is a `notifications` table (recipient user id, kind, subject reference, created_at, read_at, and optionally seen_at or toasted_at). The unread count would be `count(*) where recipient = ? and read_at is null`, a synchronous indexed query, like the other tables in `app/db/schema.ts` (for example `comments` and `video_watch_events`).
- **React / SSR fit.** The data comes from a loader such as the root loader or a layout loader, so the bell, the count and the "new since last load" toast list are all in the SSR HTML. There is no client SDK and no client-side key. Mark-read is a React Router action.
- **Server API to create a Notification.** A Drizzle `insert` from the code path that handles the event. Because `better-sqlite3` is synchronous, the insert can share a transaction with the domain write, such as a refund approval. That makes creation atomic with the event.
- **Email.** Unchanged. The same code path can call the existing `MailTransport`. There is no second email pipeline.
- **Pricing.** No vendor cost. The cost is build and maintenance time: schema, migration and seed (see the `database-migrations` skill), UI, lifecycle rules and tests.
- **Local dev and tests without network.** Works the same way as the rest of the app: seed data in SQLite and Vitest against the database. No network is needed.
- **Lock-in and data residency.** None. Data stays in `data.db` with everything else.
- **What is not included.** Anything a vendor gives for free: a prebuilt inbox UI, batching and digests ("5 new replies"), preferences, multi-channel orchestration, real-time delivery, and delivery logs. Each must be built when needed. v1 excludes preferences and live delivery (map #4 "Out of scope").

---

## 2a. Knock (hosted only)

- **Inbox model.** Feed messages have the states seen, read, interacted and archived. The feed API "returns aggregate values for unread counts, read counts, and seen counts, for use in feed badge UIs." Messages come back in reverse chronological order, and that order can't be changed. [Feeds overview](https://docs.knock.app/in-app-ui/feeds/overview)
  - REST: `GET /v1/users/{user_id}/feeds/{id}`. Its `meta` holds `total_count`, `unread_count` and `unseen_count`. Filters are `status`, `source`, `tenant`, `archived`, `inserted_at.*` and others. [List feed items](https://docs.knock.app/api-reference/users/feeds/list_items)
- **React SDK.** `@knocklabs/react` provides `NotificationFeedPopover`, `NotificationFeed` and `NotificationIconButton`, plus hooks for headless UI. It builds on `@knocklabs/client`. [React overview](https://docs.knock.app/in-app-ui/react/overview)
  - Real-time: "When a new message is sent to an in-app feed channel, the service pushes it to the client over a websocket." [Feeds overview](https://docs.knock.app/in-app-ui/feeds/overview)
  - Client auth: by default only the public API key is needed, and requests with it can act as any user. In production, "enhanced security mode" requires a signed user token. The server signs an RS256 JWT with `sub` = the user id, using `KNOCK_SIGNING_KEY`, with no network call, and passes it to `KnockProvider` (`userToken`). [Security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
  - **SSR:** the React overview and the SDK reference say nothing about SSR, `'use client'` or initial server data ([SDK reference](https://docs.knock.app/in-app-ui/react/sdk/reference)). To render the count in a loader, call the REST feed endpoint from the server. The docs say a client call needs "your publishable key along with a user token". I did not find a statement on server-side calls with the secret key.
- **Server API.** `POST /v1/workflows/{key}/trigger` with `recipients`, `data`, `actor`, `tenant`, `cancellation_key` and `settings`. [Trigger workflow](https://docs.knock.app/api-reference/workflows/trigger). Notifications are modelled as **workflows** that you set up in the Knock dashboard, each with channel steps (in-app feed, email, and others).
- **Email and Postmark.** Knock has a Postmark channel. It sends "on your behalf" with **your Postmark server API key**, from address, webhook and overrides, on the `"outbound"` stream by default. [Knock Postmark integration](https://docs.knock.app/integrations/email/postmark). Inference, not stated by Knock: a workflow can also contain only an in-app step, so email could stay in `mailer.server.ts`. That would split the email templates between two systems if some emails later move to Knock.
- **Pricing.** Free: $0, up to 10,000 messages/month, unlimited feeds and profiles, unlimited (configurable) feed retention, 30-day log retention. Knock does not hard-cap and contacts you about billing if you go over. Starter: $250/month for 50,000 messages, then $0.005 each. A message is "per delivered message on a single channel", so an in-app message and an email for the same event count as 2. [Knock pricing](https://knock.app/pricing)
- **Local dev and tests without network.** Knock environments (development, production, and others) each have isolated data and their own keys. Workflows are built in development and promoted. The docs mention no local emulator or mock server. [Environments](https://docs.knock.app/concepts/environments). Offline tests would need a stub of our own around the SDK or REST calls.
- **Lock-in and data residency.** Workflow definitions and feed state live in Knock. The pricing page mentions no EU region or self-hosting, and "dedicated infrastructure" is a contact-us item ([pricing](https://knock.app/pricing)). All 19 listed subprocessors, including AWS hosting and Postmark itself, are in the USA. [Subprocessors](https://knock.app/legal/subprocessors)

## 2b. Novu (cloud and self-hosted)

- **Inbox model.** Each feed item has `read`, `seen` and `archived` flags. The v1 subscriber feed `GET /v1/subscribers/{subscriberId}/notifications/feed` filters on `read` and `seen`. It is marked "deprecated, use v2 API instead". [Subscriber feed](https://docs.novu.co/api-reference/subscribers/retrieve-subscriber-notifications). The Inbox component "manages the unread count shown on the bell". [Inbox overview](https://docs.novu.co/platform/inbox/overview)
- **React SDK.** `@novu/react` (React 18 or later) provides an `<Inbox />` built from Bell, Notifications, InboxContent and Preferences. There is also `@novu/nextjs`, whose example starts with `'use client'`. The inbox gives real-time updates. [Inbox overview](https://docs.novu.co/platform/inbox/overview), [React get-started](https://docs.novu.co/platform/inbox/react/get-started)
  - Auth: `applicationIdentifier` plus `subscriberId`. In production you add `subscriberHash` = `HMAC-SHA256(secretKey, subscriberId)`, computed on the server. The EU region needs `apiUrl: https://eu.api.novu.co` and `socketUrl: wss://eu.socket.novu.co`. [Prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production)
  - **SSR:** no SSR guidance is published. To render the count in a loader, call the REST API with the secret key from the server.
- **Server API.** `POST /v1/events/trigger` with `Authorization: ApiKey <secret>` and `name` (workflow id), `to` (up to 100 recipients), `payload`, `actor` and `tenant`. Node SDK: `@novu/api`, `novu.trigger({ workflowId, to, payload })`. EU base URL: `https://eu.api.novu.co`. [Trigger event](https://docs.novu.co/api-reference/events/trigger-event)
- **Email and Postmark.** Novu has a Postmark email provider that takes your Postmark server API token and a verified sender. [Novu Postmark](https://docs.novu.co/platform/integrations/email/postmark). Coexistence works the same way as Knock: workflows can be in-app only (inference).
- **Pricing (cloud).** Free: $0, 10,000 workflow runs/month, 5 workflows, 2 environments, 3 team members, 24h activity-feed retention, "US + EU data residency". Pro: from $30, 30,000 runs, 20 workflows, 7-day retention, $1.20 per extra 1,000 runs. Team: from $250, 250,000 runs. Subscribers are unlimited on every plan. [Novu pricing](https://novu.co/pricing). Note that the 5-workflow cap on Free limits how many event kinds can be distinct workflows.
- **Self-hosted.** The core is MIT and the `enterprise` folder is under a commercial licence ([GitHub novuhq/novu](https://github.com/novuhq/novu)). The pricing page sells "self-hosted deployment options" only on Enterprise ([pricing](https://novu.co/pricing)). The docs say "some features exclusive to Novu's cloud-managed solution will not be available in a self-hosted environment" (Inbox features, email activity tracking, SSO and RBAC are named). Requirements: API, Worker, WS and Dashboard services, **MongoDB, Redis (AOF) and S3-compatible object storage**. A single VM needs at least 4 vCPU and 8 GB RAM. [Self-hosting overview](https://docs.novu.co/community/self-hosting-novu/overview). Running it locally needs Node 22, pnpm, Docker for MongoDB, Redis and LocalStack, and about 8 GB of RAM. [Run locally](https://docs.novu.co/community/run-in-local-machine). That is new infrastructure, which the map rules out for v1.
- **Local dev and tests without network.** Cloud needs network. Keyless mode exists "only for testing" and still talks to Novu ([React get-started](https://docs.novu.co/platform/inbox/react/get-started)). A self-hosted Novu stack in Docker could run offline, but the docs don't confirm that.
- **Lock-in and data residency.** Cloud offers US and EU regions (EU on Free). Enterprise adds more regions. Self-hosting removes the vendor dependency but adds MongoDB and Redis to operate.

## 2c. MagicBell (hosted only)

- **Inbox model.** Read/unread, archive and delete ([In-app channel](https://www.magicbell.com/docs/channels/in_app)). The API reference has endpoints to mark a notification read, unread or seen, mark all read or seen, archive and unarchive, list, and "Count unread notifications" ([API reference](https://www.magicbell.com/docs/api/reference)). I could not read the exact paths for these in the fetched page.
- **React SDK.** `@magicbell/react` provides `ContextProvider`, `Inbox`, `FloatingInbox`, `InlineNotification`, `ToastContainer`, `UserPreferences` and others. "You'll need a User JWT to use the SDK", passed as `token` and generated by your server. The docs have no SSR guidance. [React library](https://www.magicbell.com/docs/libraries/magicbell-react). "MagicBell maintains a persistent connection to deliver notifications in real-time." [In-app channel](https://www.magicbell.com/docs/channels/in_app)
- **Server API.** `POST https://api.magicbell.com/v2/broadcasts` with a Project JWT (`authorization: Bearer`) and `title`, `content`, `action_url`, `recipients` (1 to 1,000), `category`, `topic`, `custom_attributes` and `overrides`. [API reference](https://www.magicbell.com/docs/api/reference), [Broadcast](https://www.magicbell.com/docs/primitive/broadcast)
- **Email and Postmark.** The listed email providers are Amazon SES, Mailgun, Ping Email, SMTP and SendGrid. **Postmark is not listed** ([docs index](https://www.magicbell.com/docs)). The generic SMTP channel takes host, port, username and password ([SMTP](https://www.magicbell.com/docs/channels/email/smtp)). Inference, not stated by MagicBell: Postmark's SMTP endpoint could be used here, but this is not documented. MagicBell could also be in-app only, with email staying in `mailer.server.ts`.
- **Pricing.** Builder: $0, 1,000 deliveries/month, unlimited users, 1 project. Startup: $249/month, 50,000 deliveries, then $0.0025 each. [MagicBell pricing](https://www.magicbell.com/pricing)
- **Local dev and tests without network.** The docs describe no emulator or offline mode.
- **Lock-in and data residency.** The pricing page mentions no EU region, and the only base URL shown is `api.magicbell.com`.

---

## 3. Postmark

Postmark sells only email: transactional email over its API and SMTP, bulk/broadcast streams, inbound email processing, templates and webhooks. The pricing page mentions no in-app, push or SMS. [Postmark pricing](https://postmarkapp.com/pricing). I found no Postmark in-app inbox product. Postmark's only role here is as the email provider that Knock and Novu can drive with our server token, while Cadence currently calls it directly.

---

## Comparison table

| | Homegrown (Drizzle) | Knock | Novu Cloud | Novu self-hosted | MagicBell | Postmark |
|---|---|---|---|---|---|---|
| In-app inbox | We build it | Yes: seen/read/interacted/archived | Yes: read/seen/archived | Yes (some Inbox features cloud-only) | Yes: read/seen/archived | **No** |
| Unread count | SQL count | `meta.unread_count`, `unseen_count` | Inbox-managed; v1 feed filter on `read` | As cloud | "Count unread" endpoint | n/a |
| React SDK | None needed (our components) | `@knocklabs/react` | `@novu/react`, `@novu/nextjs` | Same | `@magicbell/react` | n/a |
| SSR loader fit | Native: count and list in loader HTML | No SSR docs; server REST call possible, secret-key feed read not confirmed | No SSR docs; REST with secret key | Same | No SSR docs | n/a |
| Live delivery built in | No (v1 doesn't need it) | WebSocket | Real-time | Needs WS service | Persistent connection | n/a |
| Create a Notification | Drizzle insert, can share the domain transaction | `POST /v1/workflows/{key}/trigger` | `POST /v1/events/trigger` | Same | `POST /v2/broadcasts` | n/a |
| Atomic with domain write | Yes (same SQLite transaction) | No (network call after commit) | No | No (separate service) | No | n/a |
| Email channel | Existing `mailer.server.ts` | Yes, Postmark channel with our token | Yes, Postmark provider | Yes | SES/Mailgun/SendGrid/SMTP; Postmark not listed | It *is* our email |
| Free tier | n/a | 10k messages/mo | 10k runs/mo, 5 workflows, 24h activity log | Software free (MIT core); infra cost | 1k deliveries/mo | — |
| First paid tier | n/a | $250/mo, 50k msgs | $30/mo, 30k runs | Enterprise for supported self-host | $249/mo, 50k deliveries | — |
| New infrastructure | None | None (SaaS) | None (SaaS) | MongoDB, Redis, S3, 4 services | None (SaaS) | — |
| Offline dev and tests | Yes | No emulator; stub needed | No (keyless still remote) | Possible via Docker (unconfirmed) | No emulator documented | `.outbox/` already |
| Data residency | Our SQLite file | US subprocessors; no EU region listed | US + EU (EU on Free) | Wherever we host | No EU region listed | — |
| Lock-in | None | Workflows and feed state in Knock | Workflows in Novu | Low (MIT core) but operational burden | Feed in MagicBell | — |

## Facts most relevant to the decision

1. **Postmark has no in-app product.** Option 3 drops out as an inbox. Postmark stays as the email transport under every option.
2. **Every hosted SDK is built around a client-side, real-time component** (WebSocket or persistent connection) with a client token (Knock JWT, Novu HMAC, MagicBell User JWT). None of them publishes SSR guidance. For v1's "next page load only" model rendered from loaders, a hosted option means either a client-rendered widget or server-side REST calls from loaders. A REST call is a network round trip on every page load, unlike the synchronous SQLite read (ADR 0006).
3. **Only the homegrown option can create a Notification in the same transaction as the domain event.** A hosted trigger is a separate network call that can fail or run after the commit.
4. **Free tiers cover the expected volume at first** (Knock 10k messages, Novu 10k runs, MagicBell 1k deliveries a month). Knock and MagicBell then jump to about $250/month. Novu Pro starts at $30/month. Knock counts each channel delivery as a separate message. Novu Free caps workflows at 5.
5. **Knock and Novu can send email through our own Postmark token.** MagicBell does not list Postmark. All three can also be used in-app only, leaving `mailer.server.ts` untouched (inference from how workflows and channels are modelled).
6. **Offline dev and tests:** only the homegrown option (and possibly a Docker self-hosted Novu) works without network, which matches the existing `.outbox/` pattern. The hosted options need a stub of our own in tests.
7. **Self-hosted Novu needs MongoDB, Redis and object storage**, which conflicts with "no new infrastructure" and the single-process, single-SQLite constraint.
8. **What buying would give that v1 doesn't need yet:** real-time delivery, preferences, digests and batching, multi-channel orchestration. Map #4 puts preferences and live delivery out of scope for v1. Grouping ("5 new replies") is still unspecified.

## Gaps and unverified points

- Whether Knock's feed endpoint can be read server-side with the secret key (the docs only cover the client case).
- The exact MagicBell notification endpoint paths, and whether Postmark SMTP works with it.
- Knock data residency beyond "all subprocessors in USA". Knock might offer an EU region through sales.
- The exact Inbox features Novu self-hosted lacks (the comparison page linked from the self-hosting overview returned 404).
