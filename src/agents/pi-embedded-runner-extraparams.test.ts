import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { AssistantMessageEventStream } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
  applyExtraParamsToAgent,
  resolveDisableToolsFromExtraParams,
  resolveExtraParams,
} from "./pi-embedded-runner.js";

describe("resolveExtraParams", () => {
  it("returns undefined with no model config", () => {
    const result = resolveExtraParams({
      cfg: undefined,
      provider: "zai",
      modelId: "glm-4.7",
    });

    expect(result).toBeUndefined();
  });

  it("returns params for exact provider/model key", () => {
    const result = resolveExtraParams({
      cfg: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-4": {
                params: {
                  temperature: 0.7,
                  maxTokens: 2048,
                },
              },
            },
          },
        },
      },
      provider: "openai",
      modelId: "gpt-4",
    });

    expect(result).toEqual({
      temperature: 0.7,
      maxTokens: 2048,
    });
  });

  it("ignores unrelated model entries", () => {
    const result = resolveExtraParams({
      cfg: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-4": {
                params: {
                  temperature: 0.7,
                },
              },
            },
          },
        },
      },
      provider: "openai",
      modelId: "gpt-4.1-mini",
    });

    expect(result).toBeUndefined();
  });
});

describe("applyExtraParamsToAgent", () => {
  it("adds OpenRouter attribution headers to stream options", () => {
    const calls: Array<SimpleStreamOptions | undefined> = [];
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      calls.push(options);
      return new AssistantMessageEventStream();
    };
    const agent = { streamFn: baseStreamFn };

    applyExtraParamsToAgent(agent, undefined, "openrouter", "openrouter/auto");

    const model = {
      api: "openai-completions",
      provider: "openrouter",
      id: "openrouter/auto",
    } as Model<"openai-completions">;
    const context: Context = { messages: [] };

    void agent.streamFn?.(model, context, { headers: { "X-Custom": "1" } });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toEqual({
      "HTTP-Referer": "https://openclaw.ai",
      "X-Title": "OpenClaw",
      "X-Custom": "1",
    });
  });
});

describe("resolveDisableToolsFromExtraParams", () => {
  it("returns true when model params disable tools", () => {
    const result = resolveDisableToolsFromExtraParams({
      cfg: {
        agents: {
          defaults: {
            models: {
              "kilo/z-ai/glm-5:free": {
                params: {
                  disableTools: true,
                },
              },
            },
          },
        },
      },
      provider: "kilo",
      modelId: "z-ai/glm-5:free",
    });

    expect(result).toBe(true);
  });

  it("parses string values for disableTools", () => {
    const result = resolveDisableToolsFromExtraParams({
      cfg: {
        agents: {
          defaults: {
            models: {
              "kilo/minimax/minimax-m2.5:free": {
                params: {
                  disableTools: "true",
                },
              },
            },
          },
        },
      },
      provider: "kilo",
      modelId: "minimax/minimax-m2.5:free",
    });

    expect(result).toBe(true);
  });

  it("lets explicit overrides re-enable tools", () => {
    const result = resolveDisableToolsFromExtraParams({
      cfg: {
        agents: {
          defaults: {
            models: {
              "kilo/arcee-ai/trinity-large-preview:free": {
                params: {
                  disableTools: true,
                },
              },
            },
          },
        },
      },
      provider: "kilo",
      modelId: "arcee-ai/trinity-large-preview:free",
      extraParamsOverride: {
        disableTools: false,
      },
    });

    expect(result).toBe(false);
  });
});
