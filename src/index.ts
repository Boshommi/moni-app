import logger from "@/boot/logger";
import { bot } from "@/boot/bot";
import { auth } from "@/middleware/auth";
import { run, sequentialize } from "@grammyjs/runner";
import { Context } from "grammy";
import { addExpenseSchema } from './schemes';
import { db } from '@/boot/db';

bot.use(auth);

function getSessionKey(ctx: Context) {
    return ctx.chat?.id.toString();
}

bot.use(sequentialize(getSessionKey));

logger.info("Starting bot...");

bot.command('start', (ctx) => ctx.reply(ctx.t('start')));

bot.command("add", async (ctx) => {
    const item = ctx.match;

    const parts = item.split(' ');

    const amountRaw = parts[0];
    const amount = parseInt(amountRaw ?? '');
    const description = parts.slice(1).join(' ');

    const result = addExpenseSchema.safeParse({
        amount,
        description,
        payerId: ctx.user.id,
    });

    if (!result.success) {
        await ctx.reply(ctx.t('invalid_expense_format'));
        return;
    }

    if (!ctx.message?.message_id) {
        await ctx.reply(ctx.t('message_id_not_found'));
        return;
    }

    await db.expense.create({
        data: {
            amount: amount,
            description: description,
            payerId: ctx.user.id,
            messageId: ctx.message?.message_id,
        },
    });

    await ctx.reply(ctx.t('expense_added'));
});

bot.command('delete', async (ctx) => {
    if (!ctx.from) return;

    const repliedTo = ctx.message?.reply_to_message;
    if (!repliedTo) {
        await ctx.reply(ctx.t('delete_reply_to_message'));
        return;
    }

    const expense = await db.expense.findUnique({
        where: {
            messageId: repliedTo.message_id,
        },
    });

    if (!expense) {
        await ctx.reply(ctx.t('not_an_expense_message'));
        return;
    }

    if (expense.payerId !== ctx.from.id) {
        await ctx.reply(ctx.t('not_your_expense'));
        return;
    }

    await db.expense.delete({
        where: {
            id: expense.id,
        },
    });

    await ctx.reply(ctx.t('expense_deleted'));
});

bot.on('edited_message', async (ctx) => {
    if (!ctx.from) return;

    const message = ctx.editedMessage;
    const text = message.text;

    // We need to check if this message corresponds to an expense.
    const expense = await db.expense.findUnique({
        where: {
            messageId: message.message_id
        }
    });

    if (!expense) {
        return;
    }

    if (expense.payerId !== ctx.from.id) {
        return;
    }

    if (!text) {
        return;
    }

    // The text of an edited message will be the full text. If the original was /add 100 foo
    // and user edits it to "150 bar", the text will be "150 bar".
    // If they edit it to "/add 150 bar", the text will be "/add 150 bar".
    // We should handle both cases.
    let content = text;
    if (text.startsWith('/add ')) {
        content = text.substring(5);
    }

    const parts = content.split(' ');
    const amountRaw = parts[0];
    const amount = parseInt(amountRaw ?? '', 10);
    const description = parts.slice(1).join(' ');

    const result = addExpenseSchema.safeParse({
        amount,
        description,
        payerId: ctx.from.id,
    });

    if (!result.success) {
        await ctx.reply(ctx.t('invalid_expense_format_edited'));
        return;
    }

    await db.expense.update({
        where: { id: expense.id },
        data: {
            amount: result.data.amount,
            description: result.data.description,
        },
    });

    await ctx.reply(ctx.t('expense_updated'));
});

run(bot);
