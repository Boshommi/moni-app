import { env } from "@/env";
import { Bot } from "grammy";
import { I18n, type I18nFlavor } from "@grammyjs/i18n";
import type { MyContext } from "@/types/context";

// Create a bot object
export const bot = new Bot<MyContext>(env.TELEGRAM_API_KEY); // <-- place your bot token here

await bot.api.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "add", description: "Add an expense" },
  { command: "transactions", description: "View recent transactions" },
  { command: "balance", description: "Check group balance" },
  { command: "members", description: "Manage group members" },
  { command: "test", description: "Test command" },
]);

// Initialise i18n middleware
const i18n = new I18n<MyContext>({
  defaultLocale: "en",
  directory: "locales",
});

bot.use(i18n);

// "/add 4000 Beer 4 boetls"
