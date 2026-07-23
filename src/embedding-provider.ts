export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embedDocuments(inputs: string[]): Promise<EmbeddingCallResult>;
  embedQuery(query: string): Promise<EmbeddingCallResult>;
}

export interface EmbeddingCallResult {
  vectors: number[][];
  coldLoad: boolean;
}

export interface HttpResponse {
  status: number;
  text: string;
}

export type HttpPost = (url: string, body: string) => Promise<HttpResponse>;

export class EmbeddingError extends Error {
  constructor(message: string, public readonly kind: "connection" | "response" | "validation" = "response") {
    super(message);
    this.name = "EmbeddingError";
  }
}

export interface OllamaOptions {
  endpoint: string;
  model: string;
  dimensions: number;
  keepAlive: string;
  queryInstruction: string;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;

  constructor(private readonly options: OllamaOptions, private readonly post: HttpPost) {
    this.model = options.model;
    this.dimensions = options.dimensions;
  }

  embedDocuments(inputs: string[]): Promise<EmbeddingCallResult> {
    return this.embed(inputs, inputs);
  }

  embedQuery(query: string): Promise<EmbeddingCallResult> {
    const input = `Instruct: ${this.options.queryInstruction}\nQuery:${query}`;
    return this.embed([input], [query]);
  }

  private async embed(inputs: string[], expectedInputs: string[]): Promise<EmbeddingCallResult> {
    if (!inputs.length || inputs.some((input) => !input.trim())) {
      throw new EmbeddingError("Embedding input must contain at least one non-empty string", "validation");
    }
    let response: HttpResponse;
    try {
      response = await this.post(this.options.endpoint, JSON.stringify({
        model: this.model,
        input: inputs,
        dimensions: this.dimensions,
        keep_alive: this.options.keepAlive
      }));
    } catch (error) {
      throw new EmbeddingError(`Cannot reach Ollama: ${error instanceof Error ? error.message : String(error)}`, "connection");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new EmbeddingError(`Ollama returned HTTP ${response.status}: ${response.text.slice(0, 300)}`, "response");
    }
    let payload: { embeddings?: unknown; load_duration?: unknown };
    try {
      payload = JSON.parse(response.text) as { embeddings?: unknown; load_duration?: unknown };
    } catch {
      throw new EmbeddingError("Ollama returned invalid JSON", "response");
    }
    if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== expectedInputs.length) {
      throw new EmbeddingError(`Ollama returned ${Array.isArray(payload.embeddings) ? payload.embeddings.length : "no"} embeddings for ${expectedInputs.length} inputs`, "validation");
    }
    const vectors = payload.embeddings.map((vector, index) => {
      if (!Array.isArray(vector) || vector.length !== this.dimensions || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        throw new EmbeddingError(`Embedding ${index + 1} is not a finite ${this.dimensions}-dimensional vector`, "validation");
      }
      return vector as number[];
    });
    // Ollama may report a tiny non-zero preparation/load duration even while the
    // resident model is warm. The verified real cold load is seconds, so avoid
    // misleading the sidebar by treating only a material (>= 500 ms) load as cold.
    return { vectors, coldLoad: typeof payload.load_duration === "number" && payload.load_duration >= 500_000_000 };
  }
}
