import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchFullDescription } from "@/lib/scrapers/fetch-description";

function stubFetchHtml(html: string, init?: { ok?: boolean; status?: number }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      text: async () => html,
    })
  );
}

// Long filler so parsed text clears the per-selector length thresholds.
const long = (label: string, n = 60) =>
  Array.from({ length: n }, (_, i) => `${label} sentence ${i}.`).join(" ");

describe("fetchFullDescription", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts Indeed job description via #jobDescriptionText", async () => {
    stubFetchHtml(
      `<html><body>
        <nav>ignore me</nav>
        <div id="jobDescriptionText">${long("Indeed")}</div>
      </body></html>`
    );
    const text = await fetchFullDescription("https://indeed.com/job/1", "indeed");
    expect(text).toContain("Indeed sentence 0.");
    expect(text!.length).toBeGreaterThan(150);
  });

  it("extracts LinkedIn description via .description__text", async () => {
    stubFetchHtml(
      `<html><body>
        <div class="description__text">${long("LinkedIn")}</div>
      </body></html>`
    );
    const text = await fetchFullDescription("https://linkedin.com/job/1", "linkedin");
    expect(text).toContain("LinkedIn sentence 0.");
  });

  it("falls back to a generic container for unknown sources", async () => {
    stubFetchHtml(
      `<html><body>
        <article>${long("Generic")}</article>
      </body></html>`
    );
    const text = await fetchFullDescription("https://jobs.example.com/1", "reed");
    expect(text).toContain("Generic sentence 0.");
  });

  it("falls back to <main> when no specific container matches", async () => {
    stubFetchHtml(
      `<html><body>
        <main>${long("MainBlock", 80)}</main>
      </body></html>`
    );
    const text = await fetchFullDescription("https://jobs.example.com/2", "reed");
    expect(text).toContain("MainBlock sentence 0.");
  });

  it("strips script/style noise from the extracted text", async () => {
    stubFetchHtml(
      `<html><body>
        <div id="jobDescriptionText">
          <script>window.tracking = 1;</script>
          <style>.x { color: red; }</style>
          ${long("Clean")}
        </div>
      </body></html>`,
    );
    const text = await fetchFullDescription("https://indeed.com/job/2", "indeed");
    expect(text).not.toContain("window.tracking");
    expect(text).not.toContain("color: red");
    expect(text).toContain("Clean sentence 0.");
  });

  it("returns null when the response is not ok", async () => {
    stubFetchHtml("<html></html>", { ok: false, status: 404 });
    const text = await fetchFullDescription("https://indeed.com/gone", "indeed");
    expect(text).toBeNull();
  });

  it("returns null when nothing meaningful is found", async () => {
    stubFetchHtml(`<html><body><p>too short</p></body></html>`);
    const text = await fetchFullDescription("https://jobs.example.com/3", "reed");
    expect(text).toBeNull();
  });

  it("returns null when fetch throws (timeout / network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("The operation was aborted"))
    );
    const text = await fetchFullDescription("https://indeed.com/job/3", "indeed");
    expect(text).toBeNull();
  });
});
