// MCP tool registrations over a Backend — the single implementation both
// transports serve. LocalDataBackend for stdio; server routes wire their
// D1/R2 backend into the same functions.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Backend } from "./backend.js";

export function registerGlossaristTools(server: McpServer, backend: Backend): void {
  server.tool(
    "search_concepts",
    "Search glossarist terminology registers by designation (all languages or one)",
    { q: z.string().describe("search text"), lang: z.string().optional().describe("filter by language code"), register: z.string().optional().describe("restrict to a register id"), limit: z.number().optional().describe("max hits (default 25)") },
    async ({ q, lang, register, limit }) => {
      const hits = await backend.searchConcepts(q, { lang, register, limit });
      return { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] };
    },
  );

  server.tool(
    "search_concepts_semantic",
    "Semantic search over glossarist designations — describe the meaning, get the term; cross-lingual when lang is omitted",
    { q: z.string().describe("meaning/search text"), lang: z.string().optional().describe("restrict to a language namespace (e.g. fra)"), limit: z.number().optional().describe("max hits (default 10)") },
    async ({ q, lang, limit }) => {
      const hits = await backend.semanticSearch(q, { lang, limit });
      return { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] };
    },
  );

  server.tool(
    "get_concept",
    "Full concept entry: designations per language, sources, relations",
    { uuid: z.string().describe("concept UUID"), register: z.string().describe("register id") },
    async ({ uuid, register }) => {
      const concept = await backend.getConcept(uuid, register);
      if (!concept) return { content: [{ type: "text", text: `concept ${uuid} not found in ${register}` }] };
      return { content: [{ type: "text", text: JSON.stringify(concept, null, 2) }] };
    },
  );

  server.tool(
    "get_lineage",
    "Edition supersession chain for a concept (honest: empty where the dataset does not model it)",
    { uuid: z.string(), register: z.string() },
    async ({ uuid, register }) => {
      const lineage = await backend.getLineage(uuid, register);
      return { content: [{ type: "text", text: JSON.stringify(lineage, null, 2) }] };
    },
  );

  server.tool(
    "list_editions",
    "Edition series across registers (e.g. VIM 1984-2012, VIML 1968-2022)",
    {},
    async () => {
      const registers = await backend.listRegisters();
      const series: Record<string, unknown[]> = {};
      for (const r of registers) (series[r.series ?? r.id] ??= []).push(r);
      return { content: [{ type: "text", text: JSON.stringify(series, null, 2) }] };
    },
  );

  server.tool(
    "resolve_citation",
    "Resolve a citation URN (e.g. urn:oiml:pub:v:2:2012) to its bibliographic record",
    { urn: z.string().describe("citation URN"), register: z.string().optional() },
    async ({ urn, register }) => {
      const resolved = await backend.resolveCitation(urn, register);
      if (!resolved) return { content: [{ type: "text", text: `no bibliography record for ${urn}` }] };
      return { content: [{ type: "text", text: JSON.stringify(resolved, null, 2) }] };
    },
  );

  server.tool(
    "list_registers",
    "List served registers with counts and languages",
    {},
    async () => {
      const registers = await backend.listRegisters();
      return { content: [{ type: "text", text: JSON.stringify(registers, null, 2) }] };
    },
  );
}
