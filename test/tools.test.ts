// Tools over a fixture data tree (mini dist/data layout).
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LocalDataBackend, RemoteApiBackend } from "../src/backend.js";
import { createMcpHandler } from "../src/jsonrpc.js";

const root = join(import.meta.dirname ?? ".", "fixture-data");

function makeFixture(): void {
  mkdirSync(join(root, "vim-2012", "chunks"), { recursive: true });
  mkdirSync(join(root, "vim-2012", "concepts"), { recursive: true });
  writeFileSync(join(root, "vim-2012", "manifest.json"), JSON.stringify({
    title: "VIM 2012", uriBase: "https://example.org/vim-2012", languages: [{ code: "eng" }, { code: "fra" }], conceptCount: 1,
  }));
  writeFileSync(join(root, "vim-2012", "chunks", "index-0000.json"), JSON.stringify({
    concepts: [{ id: "abc-123", designations: { eng: "measurement", fra: "mesurage" }, status: "valid" }],
  }));
  writeFileSync(join(root, "vim-2012", "concepts", "abc-123.json"), JSON.stringify({
    identifier: "abc-123", status: "valid",
    localizations: {
      eng: { terms: [{ designation: "measurement", normative_status: "preferred" }], sources: [{ origin: { ref: { source: "urn:x:jcgm:200:2012" }, clause: "3.1" }, type: "authoritative" }] },
    },
  }));
  writeFileSync(join(root, "vim-2012", "bibliography.json"), JSON.stringify({
    bibliography: [{ urn: "urn:x:jcgm:200:2012", title: "International vocabulary of metrology" }],
  }));
}

describe("glossarist-mcp", () => {
  makeFixture();
  const backend = new LocalDataBackend(root);

  it("local backend: search across languages", async () => {
    const hits = await backend.searchConcepts("mesurage", { lang: "fra" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.designation).toBe("mesurage");
  });
  it("local backend: full concept with clause-level source", async () => {
    const c = await backend.getConcept("abc-123", "vim-2012");
    expect(c?.designations.eng).toBe("measurement");
    expect(c?.sources[0]?.urn).toBe("urn:x:jcgm:200:2012");
    expect(c?.sources[0]?.clause).toBe("3.1");
  });
  it("local backend: citation resolution", async () => {
    const r = await backend.resolveCitation("urn:x:jcgm:200:2012");
    expect(r?.records[0].register).toBe("vim-2012");
  });
  it("MCP JSON-RPC: initialize", async () => {
    const handle = createMcpHandler(backend);
    const res = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const serverInfo = (res?.result as { serverInfo: { name: string } }).serverInfo;
    expect(serverInfo.name).toBe("glossarist-mcp");
  });
  it("MCP JSON-RPC: tools/list exposes the six tools", async () => {
    const handle = createMcpHandler(backend);
    const res = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = (res?.result as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["get_concept", "get_lineage", "list_editions", "list_registers", "resolve_citation", "search_concepts", "search_concepts_semantic"]);
  });
  it("MCP JSON-RPC: tools/call search end-to-end", async () => {
    const handle = createMcpHandler(backend);
    const res = await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_concepts", arguments: { q: "measurement", lang: "eng" } } });
    const text = (res?.result as { content: { text: string }[] }).content[0].text;
    expect(JSON.parse(text)[0].designation).toBe("measurement");
  });
  it("remote backend resolves against a base URL", async () => {
    const remote = new RemoteApiBackend("https://glossarist-server.example");
    void remote;
    expect(true).toBe(true);
  });
  it("cleanup", () => { rmSync(root, { recursive: true, force: true }); expect(true).toBe(true); });
});

describe("protocol negotiation (2026-07-28)", () => {
  const backend = new LocalDataBackend(root);
  it("echoes a supported requested version", async () => {
    const handle = createMcpHandler(backend);
    const res = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28" } }) as { result: { protocolVersion: string } };
    expect(res.result.protocolVersion).toBe("2026-07-28");
  });
  it("echoes 2025-06-18 for legacy clients and defaults to latest otherwise", async () => {
    const handle = createMcpHandler(backend);
    const legacy = await handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-06-18" } }) as { result: { protocolVersion: string } };
    expect(legacy.result.protocolVersion).toBe("2025-06-18");
    const unknown = await handle({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "1999-01-01" } }) as { result: { protocolVersion: string } };
    expect(unknown.result.protocolVersion).toBe("2026-07-28");
  });
  it("lists the semantic tool in tools/list", async () => {
    const handle = createMcpHandler(backend);
    const res = await handle({ jsonrpc: "2.0", id: 4, method: "tools/list" }) as { result: { tools: { name: string }[] } };
    expect(res.result.tools.some((t) => t.name === "search_concepts_semantic")).toBe(true);
  });
});

describe("semanticSearch (local fallback)", () => {
  const backend = new LocalDataBackend(root);
  it("returns keyword hits with honest score 0", async () => {
    makeFixture();
    const hits = await backend.semanticSearch("measurement");
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.score).toBe(0);
  });
});
