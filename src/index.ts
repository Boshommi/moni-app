import logger from "@/boot/logger";
import { bot } from "@/boot/bot";
import { auth } from "@/middleware/auth";

bot.use(auth);

logger.info("Starting bot...");
bot.command('start', (ctx) => ctx.reply(ctx.t('start')));
bot.on('message', async (ctx) => {
    const message = ctx.message;
    ctx.reply(ctx.t('unknown'));
});

bot.start();
