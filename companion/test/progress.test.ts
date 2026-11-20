import { describe, expect, it } from "vitest";

describe("progress panel", () => {
  it("shows nothing when nothing runs", async () => {
    // @ts-expect-error plain JS module without types
    const { progressHtml } = await import("../../module/scripts/progress-html.js");
    expect(progressHtml([], 0, (k: string) => k)).toBe("");
  });

  it("shows a clock while writing, opens the card once written, and lets finished rows go", async () => {
    // @ts-expect-error plain JS module without types
    const { progressHtml, elapsed } = await import("../../module/scripts/progress-html.js");
    const t = (k: string) => k;
    const html = progressHtml(
      [
        { id: "a", title: "Galauche Greymane", detail: "writing the barkeep of Chadonvel", state: "work", since: 0 },
        { id: "b", title: "Griselle <b>", detail: "painting", state: "ready", since: 30_000, open: "JournalEntry.abc" },
        { id: "c", title: "Ixa", state: "done", since: 0, open: "JournalEntry.def" },
        { id: "d", title: "Oops", detail: "Claude broke the rules 3 times", state: "failed", since: 0 },
      ],
      95_000,
      t,
    );
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("fa-spinner");
    expect(rows[0]).toContain(">1:35<");
    expect(rows[0]).not.toContain("data-open");
    expect(rows[0]).not.toContain("data-dismiss");
    expect(rows[1]).toContain('data-open="JournalEntry.abc"');
    expect(rows[1]).toContain(">1:05<");
    expect(rows[1]).toContain("Griselle &lt;b&gt;");
    expect(rows[2]).toContain('data-open="JournalEntry.def"');
    expect(rows[2]).toContain('data-dismiss="c"');
    expect(rows[2]).not.toContain("gn-progress-time");
    expect(rows[3]).toContain("fa-triangle-exclamation");
    expect(rows[3]).not.toContain("data-open");
    expect([elapsed(0), elapsed(59_999), elapsed(61_000), elapsed(-5)]).toEqual(["0:00", "0:59", "1:01", "0:00"]);
    const sketching = progressHtml([{ id: "e", title: "Ormand", state: "work", since: 0, open: "sketch" }], 0, t);
    expect(sketching).toContain('data-tooltip="Progress.ReadSketch"');
    expect(sketching).toContain("fa-spinner");
  });
});
