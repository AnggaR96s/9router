import { describe, it, expect } from "vitest";
import { expandProviderFilter } from "@/lib/db/repos/errorLogsRepo.js";

describe("expandProviderFilter", () => {
  it("resolves display name to canonical id + alias", () => {
    const set = expandProviderFilter("Freebuff");
    expect(set).toContain("freebuff");
    expect(set).toContain("fb");
  });

  it("resolves alias back to canonical id", () => {
    const set = expandProviderFilter("fb");
    expect(set).toContain("freebuff");
    expect(set).toContain("fb");
  });

  it("resolves display name with space (Token Harbor)", () => {
    const set = expandProviderFilter("Token Harbor");
    expect(set).toContain("tokenharbor");
  });

  it("is case-insensitive for id", () => {
    expect(expandProviderFilter("OPENROUTER")).toContain("openrouter");
  });

  it("keeps raw unknown value (custom provider id)", () => {
    const raw = "openai-compatible-chat-abc123";
    expect(expandProviderFilter(raw)).toContain(raw);
  });

  it("returns empty for blank input", () => {
    expect(expandProviderFilter("")).toEqual([]);
    expect(expandProviderFilter(null)).toEqual([]);
  });
});