#!/usr/bin/env node
// glossarist-mcp — stdio MCP server over local data.
//   npx glossarist-mcp ./path/to/generated-data   (a dist/data-style tree)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { LocalDataBackend, type Backend } from "./backend.js";
import type { ConceptHit, ConceptEntry, RegisterInfo } from "./backend.js";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: glossarist-mcp <path-to-generated-data-dir>");
  process.exit(1);
}

const backend: Backend = new LocalDataBackend(arg);
const server = new McpServer({ name: "glossarist-mcp", version: "0.1.0" });

server.tool("search_concepts", "Search glossarist terminology registers by designation", { q: z.string(), lang: z.string().optional(), register: z.string().optional(), limit: z.number().optional() }, async ({ q, lang, register, limit }) => {
  const hits: ConceptHit[] = await backend.searchConcepts(q, { lang, register, limit });
  return { content: [{ type: "text", text: JSON.stringify(hits, null, 2) }] };
});
server.tool("get_concept", "Full concept entry", { uuid: z.string(), register: z.string() }, async ({ uuid, register }) => {
  const c: ConceptEntry | null = await backend.getConcept(uuid, register);
  return { content: [{ type: "text", text: c ? JSON.stringify(c, null, 2) : `concept ${uuid} not found in ${register}` }] };
});
server.tool("get_lineage", "Edition supersession chain (honest empty when unmodeled)", { uuid: z.string(), register: z.string() }, async ({ uuid, register }) => {
  return { content: [{ type: "text", text: JSON.stringify(await backend.getLineage(uuid, register), null, 2) }] };
});
server.tool("list_editions", "Edition series across registers", {}, async () => {
  const registers: RegisterInfo[] = await backend.listRegisters();
  const series: Record<string, unknown[]> = {};
  for (const r of registers) (series[r.series ?? r.id] ??= []).push(r);
  return { content: [{ type: "text", text: JSON.stringify(series, null, 2) }] };
});
server.tool("resolve_citation", "Resolve a citation URN to its bibliographic record", { urn: z.string(), register: z.string().optional() }, async ({ urn, register }) => {
  const r = await backend.resolveCitation(urn, register);
  return { content: [{ type: "text", text: r ? JSON.stringify(r, null, 2) : `no record for ${urn}` }] };
});
server.tool("list_registers", "List served registers", {}, async () => {
  return { content: [{ type: "text", text: JSON.stringify(await backend.listRegisters(), null, 2) }] };
});

await server.connect(new StdioServerTransport());
