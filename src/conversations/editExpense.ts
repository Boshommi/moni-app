import { db } from "@/boot/db";
import type { MyContext, MyConversation } from "@/types/context";
import { InlineKeyboard } from "grammy";

async function getExpenseDetails(id: number, currency: string, ctx: MyContext) {
    const expense = await db.expense.findUnique({ where: { id } });
    if (!expense) return ctx.t('expense_not_found');

    const currencySymbols: { [key: string]: string } = { USD: '$', EUR: '€', RUB: '₽' };
    const currencySymbol = currencySymbols[currency] || currency;

    const amountForDisplay = expense.amount / 100;
    return `${amountForDisplay}${currencySymbol} — "${expense.description}"`;
}

export async function editExpenseConversation(conversation: MyConversation, ctx: MyContext) {
    const expenseId = ctx.session.expenseId;

    if (!expenseId) {
        await ctx.reply(ctx.t('edit_expense_something_wrong'));
        return;
    }

    const expense = await db.expense.findUnique({ where: { id: expenseId } });

    if (!expense || expense.payerId !== BigInt(ctx.from?.id ?? 0)) {
        await ctx.reply(ctx.t('cant_edit_expense'));
        return;
    }

    const group = await db.group.findUnique({ where: { id: expense.groupId } });

    const keyboard = new InlineKeyboard()
        .text(ctx.t('edit_amount_button'), "edit_amount")
        .text(ctx.t('edit_description_button'), "edit_description")
        .row()
        .text(ctx.t('cancel_button'), "cancel_edit");

    await ctx.reply(`What do you want to change?\n\n${await getExpenseDetails(expenseId, group?.currency ?? 'USD', ctx)}`, {
        reply_markup: keyboard,
    });

    const choiceCtx = await conversation.waitForCallbackQuery(["edit_amount", "edit_description", "cancel_edit"]);
    const choice = choiceCtx.callbackQuery.data;

    if (choice === 'cancel_edit') {
        await choiceCtx.answerCallbackQuery({ text: ctx.t('edit_canceled') });
        await choiceCtx.deleteMessage();
        return;
    }

    await choiceCtx.answerCallbackQuery();

    if (choice === 'edit_amount') {
        await choiceCtx.editMessageText(ctx.t('edit_amount_prompt'));
        const { message } = await conversation.waitFor("message:text");

        const amountInMajorUnits = parseFloat(message.text.replace(',', '.'));
        if (isNaN(amountInMajorUnits) || amountInMajorUnits <= 0) {
            await ctx.reply(ctx.t('invalid_amount_edit_canceled'));
            return;
        }

        const newAmount = Math.round(amountInMajorUnits * 100);
        await conversation.external(() => db.expense.update({ where: { id: expenseId }, data: { amount: newAmount } }));
        await ctx.reply(ctx.t('amount_updated', { amount: amountInMajorUnits }));

    } else if (choice === 'edit_description') {
        await choiceCtx.editMessageText(ctx.t('edit_description_prompt'));
        const { message } = await conversation.waitFor("message:text");
        const newDescription = message.text;

        await conversation.external(() => db.expense.update({ where: { id: expenseId }, data: { description: newDescription } }));
        await ctx.reply(ctx.t('description_updated', { description: newDescription }));
    }
} 
