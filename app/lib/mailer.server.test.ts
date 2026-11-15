import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { outboxTransport, sendEmail } from "./mailer.server";

const NOW = new Date("2027-02-18T12:00:00Z");

describe("sendEmail", () => {
  it("writes the message to the outbox, named by the time it was sent", async () => {
    const directory = mkdtempSync(join(tmpdir(), "outbox-"));

    await sendEmail(
      { to: "liam@example.com", subject: "Hello", body: "Hi Liam" },
      NOW,
      outboxTransport(directory)
    );

    const files = readdirSync(directory);
    expect(files).toEqual(["1802952000000-liam@example.com.json"]);
    const written = JSON.parse(readFileSync(join(directory, files[0]), "utf8"));
    expect(written).toMatchObject({
      to: "liam@example.com",
      subject: "Hello",
      body: "Hi Liam",
    });
  });
});
