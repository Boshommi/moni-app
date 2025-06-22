import { env } from '@/env';
import { Bot, Context } from 'grammy';
import { I18n, type I18nFlavor } from '@grammyjs/i18n';

// Define a custom context that includes i18n helpers
export type MyContext = Context & I18nFlavor;

// Create a bot object
export const bot = new Bot<MyContext>(env.TELEGRAM_API_KEY); // <-- place your bot token here

await bot.api.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'add', description: 'Add an expense' },
]);

// Initialise i18n middleware
const i18n = new I18n<MyContext>({
    defaultLocale: 'en',
    directory: 'locales',
});

bot.use(i18n);

// "/add 4000 Beer 4 boetls"
