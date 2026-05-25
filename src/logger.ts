/**
 * logger.ts
 *
 * Tiny structured logger with colour-coded output levels.
 * Uses chalk for terminal colours (ESM-only v5+).
 */

import chalk, { type ChalkInstance } from "chalk";

const timestamp = (): string =>
  new Date().toISOString().replace("T", " ").slice(0, 19);

const prefix = (label: string, colour: ChalkInstance): string =>
  colour(`[${timestamp()}] ${label}`);

export const logger = {
  info: (msg: string): void =>
    console.log(`${prefix("INFO ", chalk.cyan)}  ${msg}`),

  success: (msg: string): void =>
    console.log(`${prefix("OK   ", chalk.green)}  ${msg}`),

  warn: (msg: string): void =>
    console.warn(`${prefix("WARN ", chalk.yellow)}  ${msg}`),

  error: (msg: string): void =>
    console.error(`${prefix("ERROR", chalk.red)}  ${msg}`),

  debug: (msg: string): void => {
    if (process.env.DEBUG === "1") {
      console.log(`${prefix("DEBUG", chalk.gray)}  ${msg}`);
    }
  },

  agent: (msg: string): void => {
    const lines = msg.split("\n").map((l) => `  ${l}`).join("\n");
    console.log(`\n${chalk.magenta("┌─ Claude ─────────────────────────────────────")}`);
    console.log(chalk.black(lines));
    console.log(chalk.magenta("└──────────────────────────────────────────────\n"));
  },

  tool: (name: string, args: Record<string, unknown>): void => {
    const argsStr = JSON.stringify(args, null, 2)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n");
    console.log(
      `${chalk.blue("⚙")}  ${chalk.bold.blue(name)}\n${chalk.gray(argsStr)}`
    );
  },

  toolResult: (snippet: string): void => {
    const display = snippet.length > 280 ? snippet.slice(0, 280) + "…" : snippet;
    console.log(`${chalk.green("✓")}  ${chalk.gray(display)}\n`);
  },

  banner: (title: string): void => {
    const line = "═".repeat(title.length + 4);
    console.log(chalk.bold.cyan(`\n╔${line}╗`));
    console.log(chalk.bold.cyan(`║  ${title}  ║`));
    console.log(chalk.bold.cyan(`╚${line}╝\n`));
  },

  separator: (): void => console.log(chalk.gray("─".repeat(60))),
};
