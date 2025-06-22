import { bot } from './boot/bot';

bot.command('start', (ctx) => ctx.reply('Hello!'));

bot.start();
