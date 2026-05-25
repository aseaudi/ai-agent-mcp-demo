/**
 * mcp-client.ts
 *
 * Thin wrapper around @modelcontextprotocol/sdk that:
 *  - Spawns one or more MCP server processes via stdio transport
 *  - Lists all available tools
 *  - Calls individual tools and returns their results
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  Tool,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

export interface MCPToolDefinition {
  serverName: string;
  actualName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildStdioCommand(
  command: string,
  args: string[],
  cwd?: string
): { command: string; args: string[] } {
  if (!cwd) {
    return { command, args };
  }

  const quoted = [command, ...args].map(shellQuote).join(" ");
  return {
    command: "/bin/sh",
    args: ["-lc", `cd ${shellQuote(cwd)} && exec ${quoted}`],
  };
}

export class MCPServerClient {
  private client: Client;
  private transport: StdioClientTransport;
  private connected = false;
  private _tools: MCPToolDefinition[] = [];
  private serverName: string;

  constructor(
    serverName: string,
    serverCommand: string,
    serverArgs: string[],
    env: Record<string, string>,
    serverCwd?: string
  ) {
    this.serverName = serverName;
    const stdio = buildStdioCommand(serverCommand, serverArgs, serverCwd);

    this.transport = new StdioClientTransport({
      command: stdio.command,
      args: stdio.args,
      env: {
        ...process.env as Record<string, string>,
        ...env,
      },
    });

    this.client = new Client(
      { name: "bitbucket-mcp-agent", version: "1.0.0" },
      { capabilities: {} }
    );
  }

  /** Connect to the MCP server and fetch the tool list */
  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    this.connected = true;
    await this.refreshTools();
  }

  /** Disconnect cleanly */
  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }

  /** Refresh the cached tool list from the server */
  async refreshTools(): Promise<MCPToolDefinition[]> {
    this.assertConnected();
    const response = await this.client.listTools();

    this._tools = response.tools.map((t: Tool) => ({
      serverName: this.serverName,
      actualName: t.name,
      name: `${this.serverName}__${t.name}`,
      description: `[${this.serverName}] ${t.description ?? ""}`.trim(),
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
    }));

    return this._tools;
  }

  /** Return the cached tool list (call connect() first) */
  get tools(): MCPToolDefinition[] {
    return this._tools;
  }

  /**
   * Invoke a tool by name with the given arguments.
   * Returns the raw CallToolResult so callers can inspect content blocks.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    this.assertConnected();
    const tool = this._tools.find((candidate) => candidate.name === name);
    if (!tool) {
      throw new Error(`Tool not found on ${this.serverName} server: ${name}`);
    }

    const result = await this.client.callTool({
      name: tool.actualName,
      arguments: args,
    });
    return result as CallToolResult;
  }

  /**
   * Convenience helper: call a tool and extract all text blocks as a
   * single joined string.
   */
  async callToolText(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const result = await this.callTool(name, args);
    return result.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("\n");
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("MCP client is not connected. Call connect() first.");
    }
  }
}

export class MultiMCPClient {
  constructor(private readonly clients: MCPServerClient[]) {}

  async connect(): Promise<void> {
    for (const client of this.clients) {
      await client.connect();
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.disconnect()));
  }

  get tools(): MCPToolDefinition[] {
    return this.clients.flatMap((client) => client.tools);
  }

  async callToolText(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const client = this.clients.find((candidate) =>
      candidate.tools.some((tool) => tool.name === name)
    );

    if (!client) {
      throw new Error(`Tool is not available from any connected MCP server: ${name}`);
    }

    return client.callToolText(name, args);
  }
}
