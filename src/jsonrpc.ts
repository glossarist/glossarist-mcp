// Minimal MCP JSON-RPC 2.0 handler (protocol 2025-06-18) for Streamable HTTP
// hosts (Cloudflare Workers) where the SDK's Node transports don't apply.
// Supports: initialize, notifications/initialized, tools/list, tools/call,
// ping. POST in / JSON out — the simple, robust Streamable HTTP profile.
import type { Backend } from "./backend.js";

type JsonRpcRequest = { jsonrpc: "2.0"; id?: number | string; method: string; params?: Record<string, unknown> };

// Negotiation: we serve the current spec (2026-07-28) and remain compatible
// with 2025-06-18 clients. If the client requests a version we know, echo it;
// if unknown, respond with our latest per the MCP negotiation rules.
const SUPPORTED_PROTOCOL_VERSIONS = ["2026-07-28", "2025-06-18"];
const LATEST_PROTOCOL_VERSION = "2026-07-28";

function result(id: number | string | undefined, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function error(id: number | string | undefined, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export function createMcpJsonRpcHandler(backend: Backend, toolSchemas: { name: string; description: string; inputSchema: unknown }[]) {
  return async function handle(body: unknown): Promise<Record<string, unknown> | null> {
    const req = body as JsonRpcRequest;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return error(req?.id, -32600, "Invalid Request");
    }
    const isNotification = req.id === undefined;
    switch (req.method) {
      case "initialize": {
        const requested = typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : undefined;
        const agreed = requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
        return result(req.id, {
          protocolVersion: agreed,
          capabilities: { tools: {} },
          serverInfo: { name: "glossarist-mcp", version: "0.2.0" },
        });
      }
      case "notifications/initialized":
        return isNotification ? null : result(req.id, {});
      case "ping":
        return result(req.id, {});
      case "tools/list":
        return result(req.id, { tools: toolSchemas });
      case "tools/call": {
        const params = req.params ?? {};
        const name = String(params.name ?? "");
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        try {
          const text = await callTool(backend, name, args);
          return result(req.id, { content: [{ type: "text", text }], isError: false });
        } catch (e) {
          return result(req.id, { content: [{ type: "text", text: String((e as Error).message) }], isError: true });
        }
      }
      default:
        if (req.method.startsWith("notifications/")) return null;
        return error(req.id, -32601, "Method not found");
    }
  };
}

async function callTool(backend: Backend, name: string, args: Record<string, unknown>): Promise<string> {
  const str = (k: string): string | undefined => (args[k] === undefined ? undefined : String(args[k]));
  const num = (k: string): number | undefined => (args[k] === undefined ? undefined : Number(args[k]));
  switch (name) {
    case "search_concepts":
      return JSON.stringify(await backend.searchConcepts(String(args.q), { lang: str("lang"), register: str("register"), limit: num("limit") }), null, 2);
    case "search_concepts_semantic":
      return JSON.stringify(await backend.semanticSearch(String(args.q), { lang: str("lang"), limit: num("limit") }), null, 2);
    case "get_concept":
      return JSON.stringify(await backend.getConcept(String(args.uuid), String(args.register)), null, 2);
    case "get_lineage":
      return JSON.stringify(await backend.getLineage(String(args.uuid), String(args.register)), null, 2);
    case "list_editions": {
      const registers = await backend.listRegisters();
      const series: Record<string, unknown[]> = {};
      for (const r of registers) (series[r.series ?? r.id] ??= []).push(r);
      return JSON.stringify(series, null, 2);
    }
    case "resolve_citation":
      return JSON.stringify(await backend.resolveCitation(String(args.urn), str("register")), null, 2);
    case "list_registers":
      return JSON.stringify(await backend.listRegisters(), null, 2);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export const MCP_TOOL_SCHEMAS = [
  {
    name: "search_concepts_semantic",
    description: "Semantic search over glossarist designations — describe the meaning, get the term; cross-lingual when lang is omitted",
    inputSchema: { type: "object", properties: { q: { type: "string", description: "meaning/search text" }, lang: { type: "string", description: "restrict to a language namespace (e.g. fra)" }, limit: { type: "number", description: "max hits (default 10)" } }, required: ["q"] },
  },
  { name: "search_concepts", description: "Search glossarist terminology registers by designation", inputSchema: { type: "object", properties: { q: { type: "string" }, lang: { type: "string" }, register: { type: "string" }, limit: { type: "number" } }, required: ["q"] } },
  { name: "get_concept", description: "Full concept entry: designations per language, sources, relations", inputSchema: { type: "object", properties: { uuid: { type: "string" }, register: { type: "string" } }, required: ["uuid", "register"] } },
  { name: "get_lineage", description: "Edition supersession chain for a concept", inputSchema: { type: "object", properties: { uuid: { type: "string" }, register: { type: "string" } }, required: ["uuid", "register"] } },
  { name: "list_editions", description: "Edition series across registers", inputSchema: { type: "object", properties: {} } },
  { name: "resolve_citation", description: "Resolve a citation URN to its bibliographic record", inputSchema: { type: "object", properties: { urn: { type: "string" }, register: { type: "string" } }, required: ["urn"] } },
  { name: "list_registers", description: "List served registers with counts and languages", inputSchema: { type: "object", properties: {} } },
];

export function createMcpHandler(backend: Backend) {
  return createMcpJsonRpcHandler(backend, MCP_TOOL_SCHEMAS);
}
