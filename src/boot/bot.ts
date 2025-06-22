import { env } from '@/env';
import { Bot } from "grammy";

// Create a bot object
export const bot = new Bot(env.TELEGRAM_API_KEY); // <-- place your bot token in this string

