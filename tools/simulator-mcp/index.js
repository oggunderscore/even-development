#!/usr/bin/env node

/**
 * EvenHub Simulator MCP Server
 *
 * Wraps the simulator's --automation-port HTTP API as MCP tools.
 * Default automation URL: http://127.0.0.1:9898
 *
 * Tools:
 *   - simulator_screenshot_glasses: Capture the glasses display (576×288 PNG)
 *   - simulator_screenshot_webview: Capture the phone WebView
 *   - simulator_input: Send a glasses input event (up, down, click, double_click)
 *   - simulator_console: Read console output from the app
 *   - simulator_console_clear: Clear the console buffer
 *   - simulator_ping: Health check
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const AUTOMATION_URL =
  process.env.SIMULATOR_AUTOMATION_URL || "http://127.0.0.1:9898";

const server = new Server(
  {
    name: "evenhub-simulator-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- Tool Definitions ---

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "simulator_screenshot_glasses",
      description:
        "Capture the current glasses display as a 576×288 PNG image. Returns the image as base64-encoded content.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "simulator_screenshot_webview",
      description:
        "Capture the phone WebView as a PNG screenshot. Shows what the user sees on the phone config UI.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "simulator_input",
      description:
        'Send a glasses touchpad input event. Valid actions: "up", "down", "click", "double_click".',
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["up", "down", "click", "double_click"],
            description: "The input action to send to the glasses.",
          },
        },
        required: ["action"],
      },
    },
    {
      name: "simulator_console",
      description:
        "Read captured console output (console.log, errors, failed fetches) from the running app. Optionally pass since_id to only get new entries.",
      inputSchema: {
        type: "object",
        properties: {
          since_id: {
            type: "number",
            description:
              "Only return entries with id greater than this value. Useful for incremental polling.",
          },
        },
        required: [],
      },
    },
    {
      name: "simulator_console_clear",
      description: "Clear the console buffer in the simulator.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "simulator_ping",
      description:
        "Health check — verifies the simulator automation API is reachable.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ],
}));

// --- Tool Handlers ---

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "simulator_screenshot_glasses": {
        const response = await fetch(`${AUTOMATION_URL}/api/screenshot/glasses`);
        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${response.status} ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        return {
          content: [
            {
              type: "image",
              data: base64,
              mimeType: "image/png",
            },
          ],
        };
      }

      case "simulator_screenshot_webview": {
        const response = await fetch(`${AUTOMATION_URL}/api/screenshot/webview`);
        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${response.status} ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        return {
          content: [
            {
              type: "image",
              data: base64,
              mimeType: "image/png",
            },
          ],
        };
      }

      case "simulator_input": {
        const action = args?.action;
        if (!action) {
          return {
            content: [{ type: "text", text: "Error: action is required" }],
            isError: true,
          };
        }
        const response = await fetch(`${AUTOMATION_URL}/api/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${response.status} ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            { type: "text", text: `Input "${action}" sent successfully.` },
          ],
        };
      }

      case "simulator_console": {
        let url = `${AUTOMATION_URL}/api/console`;
        if (args?.since_id !== undefined) {
          url += `?since_id=${args.since_id}`;
        }
        const response = await fetch(url);
        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${response.status} ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }
        const text = await response.text();
        return {
          content: [{ type: "text", text: text || "(no console output)" }],
        };
      }

      case "simulator_console_clear": {
        const response = await fetch(`${AUTOMATION_URL}/api/console`, {
          method: "DELETE",
        });
        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${response.status} ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: "Console buffer cleared." }],
        };
      }

      case "simulator_ping": {
        const response = await fetch(`${AUTOMATION_URL}/api/ping`);
        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Simulator not reachable: ${response.status}`,
              },
            ],
            isError: true,
          };
        }
        const text = await response.text();
        return {
          content: [
            { type: "text", text: `Simulator is running: ${text}` },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      content: [
        {
          type: "text",
          text: `Failed to reach simulator at ${AUTOMATION_URL}: ${message}\n\nMake sure the simulator is running with --automation-port flag:\n  evenhub-simulator http://localhost:5174 --automation-port 9898`,
        },
      ],
      isError: true,
    };
  }
});

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("EvenHub Simulator MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
