/**
 * index.ts — Entry point
 *
 * 1. Load config
 * 2. Connect to Bitbucket MCP server
 * 3. List & display available tools
 * 4. Accept a user query (CLI arg or interactive prompt)
 * 5. Run the agent loop
 * 6. Print a summary of what was done
 */

import { loadConfig } from "./config.js";
import { MCPServerClient, MultiMCPClient } from "./mcp-client.js";
import { BitbucketAgent } from "./agent.js";
import { logger } from "./logger.js";
import { select, input } from "@inquirer/prompts";

// ── Helpers ────────────────────────────────────────────────────────────────────

function printToolList(
  tools: Array<{ name: string; description: string }>
): void {
  console.log("");
  logger.info(`${tools.length} tools available from the MCP server:\n`);

  const maxNameLen = Math.max(...tools.map((t) => t.name.length));
  for (const tool of tools) {
    const pad = " ".repeat(maxNameLen - tool.name.length + 2);
    const desc =
      tool.description.length > 80
        ? tool.description.slice(0, 77) + "…"
        : tool.description;
    console.log(`  \x1b[34m${tool.name}\x1b[0m${pad}\x1b[90m${desc}\x1b[0m`);
  }
  console.log("");
}

function getUserQuery(): string {
  // Accept query from CLI argument
  const args = process.argv.slice(2);
  if (args.length > 0) return args.join(" ");
  return "";
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.banner("Bitbucket MCP Agent");

  // 1. Load configuration
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error((err as Error).message);
    process.exit(1);
  }

  logger.info(`Using model : ${config.claudeModel}`);
  logger.info(`Workspace   : ${config.bitbucketWorkspace}`);
  logger.info(`Repository  : ${config.bitbucketRepo}`);
  logger.info(
    `Branch      : ${config.targetBranch || "(default branch)"}`
  );
  logger.separator();

  // 2. Connect to MCP server
  logger.info("Connecting to MCP server(s)…");

  // @nexus2520/bitbucket-mcp-server uses BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD
  const mcpEnv: Record<string, string> = {
    BITBUCKET_USERNAME: config.bitbucketUsername,
    BITBUCKET_APP_PASSWORD: config.bitbucketAppPassword,
  };
  if (config.bitbucketBaseUrl) {
    mcpEnv["BITBUCKET_BASE_URL"] = config.bitbucketBaseUrl;
  }
  const clients = [
    new MCPServerClient(
      "bitbucket",
      config.mcpServerCommand,
      config.mcpServerArgs,
      mcpEnv,
      config.mcpServerCwd || undefined
    ),
    new MCPServerClient(
      "atlassian",
      config.atlassianMcpCommand,
      config.atlassianMcpArgs,
      {
        JIRA_URL: config.jiraUrl,
        JIRA_USERNAME: config.jiraUsername,
        JIRA_API_TOKEN: config.jiraApiToken,
        CONFLUENCE_URL: config.confluenceUrl,
        CONFLUENCE_USERNAME: config.confluenceUsername,
        CONFLUENCE_API_TOKEN: config.confluenceApiToken,
      },
      undefined
    ),
  ];

  const mcpClient = new MultiMCPClient(clients);

  try {
    await mcpClient.connect();
    logger.success(`Connected to ${clients.length} MCP server(s).`);
  } catch (err) {
    logger.error(`Failed to connect to MCP server: ${(err as Error).message}`);
    logger.error(
      "Make sure the configured MCP server command is available and any required package or Python module is installed."
    );
    process.exit(1);
  }

  // 3. List available tools
  const tools = mcpClient.tools;
  printToolList(tools);

  // 4. Get user query
  let userQuery = getUserQuery();

  if (!userQuery) {
    // Interactive mode — let the user pick a sample or type their own
    const choice = await select({
      message: "What would you like to do?",
      choices: [
        {
          name: "Add a login screen",
          value: "add a login screen with username and password fields",
        },
        {
          name: "Add a registration / sign-up page",
          value:
            "add a registration page with name, email, password, and confirm-password fields",
        },
        {
          name: "Add a dashboard page",
          value:
            "add a dashboard page that shows summary statistics and a recent activity feed",
        },
        {
          name: "Add a 404 Not Found page",
          value: "add a 404 not-found error page with a link back to the home page",
        },
        {
          name: "Add dark-mode support",
          value: "add dark-mode support with a toggle button in the navigation bar",
        },
        {
          name: "Create a Confluence page",
          value: "create a confluence page for the engineering team release notes",
        },
        {
          name: "Update a Confluence page",
          value: "update a confluence page with the latest project status",
        },
        {
          name: "Delete a Confluence page",
          value: "delete confluence page 123456",
        },
        { name: "Type a custom query…", value: "__custom__" },
      ],
    });

    if (choice === "__custom__") {
      userQuery = await input({
        message: "Describe the change you want to make:",
        validate: (v) => (v.trim().length > 3 ? true : "Please enter a description"),
      });
    } else {
      userQuery = choice;
    }
  }

  let userQuery2 = userQuery;
  if (mcpClient.tools.some((tool) => tool.serverName === "bitbucket")) {
    userQuery2 += ` Workspace is ${config.bitbucketWorkspace} and repo is ${config.bitbucketRepo}.`;
  }
  logger.separator();
  logger.info(`User query: "${userQuery}"`);
  logger.info(`User query 2: "${userQuery2}"`);
  logger.separator();

  // 5. Run the agent
  const agent = new BitbucketAgent({
    anthropicApiKey: config.anthropicApiKey,
    model: config.claudeModel,
    workspace: config.bitbucketWorkspace,
    repo: config.bitbucketRepo,
    targetBranch: config.targetBranch || undefined,
    gitAuthorName: config.gitAuthorName,
    gitAuthorEmail: config.gitAuthorEmail,
  });

  let result;
  try {
    result = await agent.run(userQuery2, mcpClient);
  } catch (err) {
    logger.error(`Agent failed: ${(err as Error).message}`);
    if (process.env.DEBUG === "1") {
      console.error(err);
    }
    await mcpClient.disconnect();
    process.exit(1);
  }

  // 6. Print summary
  logger.separator();
  logger.banner("Done");

  if (result.commitSha) {
    logger.success(`Commit SHA : ${result.commitSha}`);
  }
  if (result.filesModified.length > 0) {
    logger.success(`Files touched:`);
    for (const f of result.filesModified) {
      console.log(`    • ${f}`);
    }
  }
  logger.info(`Iterations : ${result.iterationCount}`);
  logger.separator();

  // Clean up
  await mcpClient.disconnect();
}

main().catch((err) => {
  logger.error(`Unhandled error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
