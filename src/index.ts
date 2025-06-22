import { bot } from '@/boot/bot';
import { auth } from '@/middleware/auth';

bot.use(auth);

bot.command('start', (ctx) => ctx.reply('Hello!'));

bot.start();
