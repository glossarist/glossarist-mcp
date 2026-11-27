// Transport-agnostic MCP tools over a Backend. The same implementations serve
// stdio (local datasets) and Streamable HTTP (glossarist-server routes).
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ConceptHit {
  register: string;
  uuid: string;
  identifier: string | null;
  designation: string | null;
  lang: string | null;
  status: string;
}

export interface ConceptEntry {
  register: string;
  uuid: string;
  identifier: string | null;
  status: string;
  designations: Record<string, string>;
  relations: { subject: string; predicate: string; object: string }[];
  sources: { urn: string; clause: string | null; kind: string | null }[];
  artifacts?: { jsonld: string; ttl: string; tbx: string };
}

export interface RegisterInfo {
  id: string;
  title: string | null;
  subtitle: string | null;
  uri_base: string | null;
  languages: string;
  concept_count: number;
  edition: string | null;
  series: string | null;
}

export interface SemanticHit extends ConceptHit {
  score: number;
}

export interface Backend {
  listRegisters(): Promise<RegisterInfo[]>;
  searchConcepts(q: string, opts?: { lang?: string; register?: string; limit?: number }): Promise<ConceptHit[]>;
  /** Vector search over designations; local backends fall back to keyword search honestly (score 0). */
  semanticSearch(q: string, opts?: { lang?: string; limit?: number }): Promise<SemanticHit[]>;
  getConcept(uuid: string, register: string): Promise<ConceptEntry | null>;
  getLineage(uuid: string, register: string): Promise<{ lineage: unknown[]; lineage_coverage: string; note: string }>;
  resolveCitation(urn: string, register?: string): Promise<{ urn: string; records: { register: string; record: unknown }[] } | null>;
}

/** Backend over a concept-browser generated data tree (public/data style). */
export class LocalDataBackend implements Backend {
  constructor(private readonly root: string) {}

  private registers(): string[] {
    return readdirSync(this.root).filter((n) => {
      const p = join(this.root, n);
      return statSync(p).isDirectory() && existsSync(join(p, "manifest.json"));
    });
  }

  private readJson(path: string): unknown | null {
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
  }

  async listRegisters(): Promise<RegisterInfo[]> {
    const out: RegisterInfo[] = [];
    for (const reg of this.registers()) {
      const m = this.readJson(join(this.root, reg, "manifest.json")) as Record<string, unknown> | null;
      if (!m) continue;
      out.push({
        id: reg,
        title: (m.title as string) ?? null,
        subtitle: (m.subtitle as string) ?? null,
        uri_base: (m.uriBase as string) ?? null,
        languages: JSON.stringify(m.languages ?? []),
        concept_count: Number(m.conceptCount ?? 0),
        edition: (m.year as string) ?? null,
        series: reg.replace(/-\d{4}.*$/, "") || reg,
      });
    }
    return out;
  }

  async searchConcepts(q: string, opts: { lang?: string; register?: string; limit?: number } = {}): Promise<ConceptHit[]> {
    const needle = q.toLowerCase();
    const hits: ConceptHit[] = [];
    const registers = opts.register ? [opts.register] : this.registers();
    for (const reg of registers) {
      const chunks = join(this.root, reg, "chunks");
      if (!existsSync(chunks)) continue;
      for (const f of readdirSync(chunks).filter((f: string) => f.endsWith(".json"))) {
        const chunk = this.readJson(join(chunks, f)) as { concepts?: Record<string, unknown>[] } | null;
        for (const c of chunk?.concepts ?? []) {
          const designations = (c.designations ?? {}) as Record<string, string>;
          for (const [lang, designation] of Object.entries(designations)) {
            if (!designation.toLowerCase().includes(needle)) continue;
            if (opts.lang && lang !== opts.lang) continue;
            hits.push({ register: reg, uuid: String(c.id), identifier: String(c.id), designation, lang, status: String(c.status ?? "valid") });
            if (hits.length >= (opts.limit ?? 25)) return hits;
          }
        }
      }
    }
    return hits;
  }

  async getConcept(uuid: string, register: string): Promise<ConceptEntry | null> {
    const manifest = this.readJson(join(this.root, register, "manifest.json")) as Record<string, unknown> | null;
    const c = this.readJson(join(this.root, register, "concepts", `${uuid}.json`)) as Record<string, unknown> | null;
    if (!manifest || !c) return null;
    const designations: Record<string, string> = {};
    const sources: { urn: string; clause: string | null; kind: string | null }[] = [];
    const uriBase = (manifest.uriBase as string) ?? "";
    for (const [lang, loc] of Object.entries((c.localizations ?? c.languages ?? {}) as Record<string, Record<string, unknown>>)) {
      const terms = (loc.terms ?? []) as { designation?: string; normative_status?: string }[];
      const preferred = terms.find((t) => t.normative_status === "preferred") ?? terms[0];
      if (preferred?.designation) designations[lang] = preferred.designation;
      for (const src of (loc.sources ?? []) as { origin?: { ref?: { source?: string; id?: string }; clause?: string }; type?: string }[]) {
        const urn = src.origin?.ref?.source ?? src.origin?.ref?.id;
        if (urn) sources.push({ urn: String(urn), clause: (src.origin?.clause as string) ?? null, kind: src.type ?? null });
      }
    }
    return {
      register,
      uuid,
      identifier: (c.identifier as string) ?? uuid,
      status: (c.status as string) ?? "valid",
      designations,
      relations: [],
      sources,
      artifacts: uriBase ? {
        jsonld: `${uriBase}/data/${register}/concepts/${uuid}.jsonld`,
        ttl: `${uriBase}/data/${register}/concepts/${uuid}.ttl`,
        tbx: `${uriBase}/data/${register}/concepts/${uuid}.tbx`,
      } : undefined,
    };
  }

  async getLineage(uuid: string, register: string): Promise<{ lineage: unknown[]; lineage_coverage: string; note: string }> {
    void uuid;
    return { lineage: [], lineage_coverage: "0", note: "edition supersession appears here only where the dataset models it" };
  }

  async resolveCitation(urn: string, register?: string): Promise<{ urn: string; records: { register: string; record: unknown }[] } | null> {
    const registers = register ? [register] : this.registers();
    const records: { register: string; record: unknown }[] = [];
    for (const reg of registers) {
      const bib = this.readJson(join(this.root, reg, "bibliography.json")) as { bibliography?: { urn?: string; id?: string }[] } | null;
      for (const entry of bib?.bibliography ?? []) {
        if (entry.urn === urn || entry.id === urn) records.push({ register: reg, record: entry });
      }
    }
    return records.length ? { urn, records } : null;
  }

  async semanticSearch(q: string, opts: { lang?: string; limit?: number } = {}): Promise<SemanticHit[]> {
    // Honest fallback: no vector store locally — keyword hits carry score 0.
    const hits = await this.searchConcepts(q, { lang: opts.lang, limit: opts.limit });
    return hits.map((h) => ({ ...h, score: 0 }));
  }
}

/** Backend over a remote glossarist-server /v1 API. */
export class RemoteApiBackend implements Backend {
  constructor(private readonly baseUrl: string, private readonly apiKey?: string) {}
  private headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }
  async listRegisters(): Promise<RegisterInfo[]> {
    const res = await fetch(`${this.baseUrl}/v1/registers`, { headers: this.headers() });
    const body = (await res.json()) as { registers: RegisterInfo[] };
    return body.registers;
  }
  async searchConcepts(q: string, opts: { lang?: string; register?: string; limit?: number } = {}): Promise<ConceptHit[]> {
    const p = new URLSearchParams({ q });
    if (opts.lang) p.set("lang", opts.lang);
    if (opts.register) p.set("register", opts.register);
    if (opts.limit) p.set("limit", String(opts.limit));
    const res = await fetch(`${this.baseUrl}/v1/search?${p}`, { headers: this.headers() });
    const body = (await res.json()) as { hits: ConceptHit[] };
    return body.hits;
  }
  async semanticSearch(q: string, opts: { lang?: string; limit?: number } = {}): Promise<SemanticHit[]> {
    const p = new URLSearchParams({ q, semantic: "true" });
    if (opts.lang) p.set("lang", opts.lang);
    if (opts.limit) p.set("limit", String(opts.limit));
    const res = await fetch(`${this.baseUrl}/v1/search?${p}`, { headers: this.headers() });
    const body = (await res.json()) as { hits: SemanticHit[] };
    return body.hits;
  }
  async getConcept(uuid: string, register: string): Promise<ConceptEntry | null> {
    const res = await fetch(`${this.baseUrl}/v1/concepts/${uuid}?register=${encodeURIComponent(register)}`, { headers: this.headers() });
    if (res.status === 404) return null;
    return (await res.json()) as ConceptEntry;
  }
  async getLineage(uuid: string, register: string): Promise<{ lineage: unknown[]; lineage_coverage: string; note: string }> {
    const res = await fetch(`${this.baseUrl}/v1/concepts/${uuid}/lineage?register=${encodeURIComponent(register)}`, { headers: this.headers() });
    return (await res.json()) as { lineage: unknown[]; lineage_coverage: string; note: string };
  }
  async resolveCitation(urn: string, register?: string): Promise<{ urn: string; records: { register: string; record: unknown }[] } | null> {
    const res = await fetch(`${this.baseUrl}/v1/sources/${encodeURIComponent(urn)}${register ? `?register=${encodeURIComponent(register)}` : ""}`, { headers: this.headers() });
    if (res.status === 404) return null;
    return (await res.json()) as { urn: string; records: { register: string; record: unknown }[] };
  }
}
