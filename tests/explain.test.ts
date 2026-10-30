import { describe, expect, it } from "vitest";
import { explain } from "../components/shared/explain";

describe("explain", () => {
  it("turns an API error body into a plain sentence and keeps the raw text as detail", () => {
    const raw = 'no frontispiece: /responses 400: {"error":{"code":null,"message":"tools[0]: unknown value `768x1024`","param":"tools[0]","type":"invalid_request_error"}}';
    const e = explain(raw);
    expect(e.text).toMatch(/^No frontispiece; the book opens without one\. Meta’s API rejected a setting/);
    expect(e.text).not.toMatch(/[{}"]/);
    expect(e.detail).toBe(raw);
  });
  it("names timeouts, rate limits and the budget guard", () => {
    expect(explain("plate failed: /images 503: upstream").text).toMatch(/^This plate wasn’t painted\. Meta’s API didn’t answer in time/);
    expect(explain("HTTP 429: Too many requests").text).toMatch(/busy/);
    expect(explain("Budget guard: this call would pass the stop line").text).toMatch(/spending guard/);
  });
  it("leaves plain sentences alone", () => {
    expect(explain("Muse Image declined this scene under its content policy; skipped")).toEqual({ text: "Muse Image declined this scene under its content policy; skipped" });
    expect(explain("the film renderer stopped; the book shows still plates instead").detail).toBeUndefined();
    expect(explain("")).toEqual({ text: "" });
  });
  it("hides an unknown raw error behind a generic line", () => {
    const e = explain('{"weird":true}');
    expect(e.text).toBe("This step hit an unexpected error.");
    expect(e.detail).toBe('{"weird":true}');
  });
});
