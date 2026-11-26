# glossarist-mcp

MCP server for glossarist terminology data — npm package `glossarist-mcp`.

- **Tools** (v0, read-only): `search_concepts`, `get_concept`, `get_lineage`, `list_editions`, `resolve_citation`, `list_registers`
- **Transports**: stdio (`npx glossarist-mcp ./register.gcr` — works locally on any GCR package or datasets directory) and Streamable HTTP (used by glossarist-server's `/mcp` route, wired to its D1/R2 backend)
- **Protocol**: official `@modelcontextprotocol/sdk` (owner-confirmed); our code is the tool layer only

Answers carry concept IRIs and clause citations — the same validated model humans use.
