/**
 * rollbackplan MCP server. Tools: plan_rollback.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schema as an explicit literal, and every
 * tools/call is validated by the core, which names the
 * offending path on invalid input.
 *
 * The planning is pure local computation: no upstream API,
 * no authentication, no configuration, and nothing is ever
 * executed — the tool only plans the rollback steps.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { formatPayload, planRollback, VERSION } from "./rollbackplan.js";

const TOOLS = [
  {
    name: "plan_rollback",
    description:
      "Plan a release rollback from its diff: feature flags first, then env changes, then database migrations in reverse order, with manual and blocked steps flagged.",
    inputSchema: {
      type: "object" as const,
      properties: {
        release: {
          type: "string",
          description: "Release identifier or version being rolled back",
        },
        migrations: {
          type: "array",
          description: "Migrations the release applied, in application order (optional)",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Migration identifier (unique across the set)",
              },
              reversible: {
                type: "boolean",
                description:
                  "True when the migration ships a down migration (optional, default true)",
              },
              down_id: {
                type: "string",
                description:
                  "Identifier of a compensating migration that undoes this one (optional)",
              },
            },
            required: ["id"],
          },
        },
        env_changes: {
          type: "array",
          description: "Environment variable changes the release made (optional)",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Environment variable name (unique across the set)",
              },
              action: {
                type: "string",
                enum: ["added", "changed", "removed"],
                description:
                  "What the release did to the variable: added, changed, or removed",
              },
              previous_value_known: {
                type: "boolean",
                description:
                  "True when the pre-release value is recorded (optional, default false)",
              },
            },
            required: ["name", "action"],
          },
        },
        feature_flags: {
          type: "array",
          description: "Feature flag changes the release made (optional)",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Feature flag name (unique across the set)",
              },
              change: {
                type: "string",
                enum: ["enabled", "disabled", "added", "removed"],
                description:
                  "What the release did to the flag: enabled, disabled, added, or removed",
              },
            },
            required: ["name", "change"],
          },
        },
      },
      required: ["release"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "rollbackplan", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "plan_rollback") {
      out = planRollback(args ?? {});
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
