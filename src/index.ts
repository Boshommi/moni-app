import logger from "@/boot/logger";
import { bot } from "@/boot/bot";
import { auth } from "@/middleware/auth";
import { run, sequentialize } from "@grammyjs/runner";
import { Context, InlineKeyboard, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { addExpenseSchema } from './schemes';
import { db } from '@/boot/db';
import type { MyContext, SessionData } from "@/types/context";
import { installConversations } from "@/conversations";
import { calculateGroupBalance } from "@/logic/balance";

// Install session middleware, and define the initial session value.
bot.use(session({
    initial: (): SessionData => ({}),
}));

// Install conversations middleware
bot.use(conversations());

installConversations();

bot.use(auth);

function getSessionKey(ctx: Context) {
    return ctx.chat?.id.toString();
}

bot.use(sequentialize(getSessionKey));

logger.info("Starting bot...");

bot.on('my_chat_member', async (ctx) => {
    // This handler is for when the bot's status in a chat changes.
    // (e.g., added to a group, promoted to admin, kicked, etc.)
    const chat = ctx.chat;
    const newStatus = ctx.myChatMember.new_chat_member.status;

    // We only care about group and supergroup chats.
    if (chat.type === 'private' || chat.type === 'channel') {
        return;
    }

    if (newStatus === 'member' || newStatus === 'administrator') {
        // Bot was added to the group or was just promoted.
        const group = await db.group.upsert({
            where: { id: chat.id },
            create: { id: chat.id, title: chat.title ?? 'Group' },
            update: { title: chat.title ?? 'Group' },
        });

        // The welcome message is sent only when the bot is first added as a 'member'.
        // If it was already a member and just got promoted, we don't need to send it again.
        if (ctx.myChatMember.old_chat_member.status === 'left' || ctx.myChatMember.old_chat_member.status === 'kicked') {
             await ctx.reply(ctx.t('welcome_to_group', { groupName: group.title }));
        }

        const me = await ctx.api.getMe();
        const myMemberInfo = await ctx.api.getChatMember(ctx.chat.id, me.id);

        if (myMemberInfo.status !== 'administrator') {
            // This is a sensitive point. If the bot is not admin, it cannot see all messages
            // in privacy mode, and has limited access to member info.
            // The user story requires the bot to automatically add all members, which is
            // a feature Telegram Bot API does not directly provide for privacy reasons.
            // A bot cannot get a list of all chat members.
            //
            // Possible workarounds:
            // 1. Turn off privacy mode for the bot in BotFather. The bot will then receive all
            //    messages and can build a member list over time. It still won't get all members
            //    instantly upon joining.
            // 2. Ask users to interact with the bot (e.g., use /join command) to get registered.
            //
            // The user story is very specific: "Бот автоматически считывает всех текущих участников".
            // This is a hard constraint that is currently not feasible to implement perfectly.
            //
            // For now, we will notify the user that admin rights are needed and proceed with a
            // model where users are added as they interact with the bot.
            await ctx.reply(ctx.t('needs_admin_rights'));
            return;
        }

        // TODO: Implement member fetching and adding logic here.
        // This part is tricky as stated above.
        // As a next step, we can start by adding users who use the /add command, for example.
    }
});

bot.command('start', (ctx) => ctx.reply(ctx.t('start')));

bot.command("add", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private') {
        // TODO: maybe support adding expenses in private chat later?
        await ctx.reply(ctx.t('command_only_works_in_groups'));
        return;
    }

    const item = ctx.match;

    const parts = item.split(' ');

    const amountRaw = parts[0];

    if (!amountRaw) {
        await ctx.reply(ctx.t('invalid_expense_format'));
        return;
    }

    const description = parts.slice(1).join(' ');

    const amountInMajorUnits = parseFloat(amountRaw.replace(',', '.'));

    if (isNaN(amountInMajorUnits) || amountInMajorUnits <= 0) {
        await ctx.reply(ctx.t('invalid_expense_format'));
        return;
    }
    
    const amount = Math.round(amountInMajorUnits * 100);

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

    const activeMembers = await db.groupMember.findMany({
        where: { groupId: ctx.chat.id, status: 'ACTIVE' },
    });

    if (activeMembers.length === 0) {
        // This case should ideally not happen if at least the payer is an active member.
        await ctx.reply(ctx.t('no_active_members'));
        return;
    }

    const participantIds = activeMembers.map((member) => ({ id: member.userId }));

    const newExpense = await db.expense.create({
        data: {
            amount: result.data.amount,
            description: result.data.description,
            payerId: ctx.user.id,
            messageId: ctx.message.message_id,
            groupId: ctx.chat.id,
            participants: {
                connect: participantIds,
            },
        },
    });

    const group = await db.group.findUnique({ where: { id: ctx.chat.id } });
    const currencySymbols: { [key: string]: string } = {
        USD: '$',
        EUR: '€',
        RUB: '₽',
    };
    const currencySymbol = currencySymbols[group?.currency ?? 'USD'] || group?.currency || '';

    await ctx.reply(ctx.t('expense_added_details', {
        payerName: ctx.from?.first_name ?? 'Someone',
        amount: newExpense.amount / 100,
        currencySymbol: currencySymbol,
        description: newExpense.description,
        participantsCount: activeMembers.length,
    }));
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

    if (expense.payerId !== BigInt(ctx.from.id)) {
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

bot.command('transactions', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private') {
        await ctx.reply(ctx.t('command_only_works_in_groups'));
        return;
    }

    const group = await db.group.findUnique({
        where: { id: ctx.chat.id },
        include: {
            expenses: {
                include: {
                    payer: true, // to get the user's name
                },
                orderBy: {
                    createdAt: 'desc',
                },
                take: 10, // Let's paginate later, for now limit to 10 to avoid huge messages
            }
        }
    });

    if (!group || group.expenses.length === 0) {
        await ctx.reply(ctx.t('no_expenses_recorded'));
        return;
    }
    
    const currencySymbols: { [key: string]: string } = { USD: '$', EUR: '€', RUB: '₽' };
    const currencySymbol = currencySymbols[group.currency] || group.currency;

    let responseText = ctx.t('transactions_list') + '\n\n';
    const keyboard = new InlineKeyboard();

    group.expenses.forEach((expense, index) => {
        const amountForDisplay = expense.amount / 100;
        const dateForDisplay = expense.createdAt.toLocaleDateString('ru-RU');
        const payerUsername = expense.payer.nickname ? `@${expense.payer.nickname}` : expense.payer.firstName;

        responseText += `${index + 1}. ${amountForDisplay}${currencySymbol} — "${expense.description}" | ${dateForDisplay}, by ${payerUsername}\n`;
        
        keyboard
            .text(`✏️ Редактировать ${index + 1}`, `edit_exp:${expense.id}`)
            .text(`❌ Удалить ${index + 1}`, `delete_exp:${expense.id}`)
            .row();
    });

    await ctx.reply(responseText, { reply_markup: keyboard });
});

bot.callbackQuery(/edit_exp:(\d+)/, async (ctx) => {
    const expenseId = parseInt(ctx.match[1]!, 10);
    
    // Here we will start the conversation
    await ctx.conversation.enter('editExpenseConversation', { expenseId });
});

bot.callbackQuery(/delete_exp:(\d+)/, async (ctx) => {
    const expenseId = parseInt(ctx.match[1]!, 10);
    const userId = ctx.from.id;

    const expense = await db.expense.findUnique({ where: { id: expenseId } });

    if (!expense) {
        await ctx.answerCallbackQuery({ text: ctx.t('expense_does_not_exist') });
        return;
    }

    if (expense.payerId !== BigInt(userId)) {
        await ctx.answerCallbackQuery({ text: ctx.t('not_your_expense') });
        return;
    }

    await db.expense.delete({ where: { id: expenseId } });

    await ctx.answerCallbackQuery({ text: "Expense deleted successfully." });

    // Now, let's update the original message.
    const group = await db.group.findUnique({
        where: { id: expense.groupId },
        include: {
            expenses: {
                include: { payer: true },
                orderBy: { createdAt: 'desc' },
                take: 10,
            }
        }
    });

    if (!group || group.expenses.length === 0) {
        await ctx.editMessageText(ctx.t('all_expenses_deleted'));
        return;
    }

    const currencySymbols: { [key: string]: string } = { USD: '$', EUR: '€', RUB: '₽' };
    const currencySymbol = currencySymbols[group.currency] || group.currency || '';

    let responseText = ctx.t('transactions_list') + '\n\n';
    const keyboard = new InlineKeyboard();

    group.expenses.forEach((exp, index) => {
        const amountForDisplay = exp.amount / 100;
        const dateForDisplay = exp.createdAt.toLocaleDateString('ru-RU');
        const payerUsername = (exp.payer.nickname ? `@${exp.payer.nickname}` : exp.payer.firstName) ?? 'Unknown';
        const description = exp.description ?? '';

        responseText += `${index + 1}. ${amountForDisplay}${currencySymbol} — "${description}" | ${dateForDisplay}, by ${payerUsername}\n`;
        keyboard.text(`✏️ Редактировать ${index + 1}`, `edit_exp:${exp.id}`).text(`❌ Удалить ${index + 1}`, `delete_exp:${exp.id}`).row();
    });

    await ctx.editMessageText(responseText, { reply_markup: keyboard });
});

bot.command('members', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private') {
        await ctx.reply(ctx.t('command_only_works_in_groups'));
        return;
    }

    const members = await db.groupMember.findMany({
        where: { groupId: ctx.chat.id },
        include: { user: true },
        orderBy: { user: { firstName: 'asc' } },
    });

    if (members.length === 0) {
        await ctx.reply(ctx.t('no_members_yet'));
        return;
    }

    let responseText = ctx.t('members_status_list') + '\n\n';
    const keyboard = new InlineKeyboard();

    members.forEach((member) => {
        const statusIcon = member.status === 'ACTIVE' ? '🟢' : '⚪️';
        const actionText = member.status === 'ACTIVE' ? ctx.t('deactivate_member_button') : ctx.t('activate_member_button');
        const actionCallback = member.status === 'ACTIVE' ? `deactivate_member:${member.userId}` : `activate_member:${member.userId}`;
        const userName = member.user.nickname ? `@${member.user.nickname}` : `${member.user.firstName} ${member.user.lastName || ''}`.trim();

        responseText += `${statusIcon} ${userName}\n`;
        keyboard.text(actionText, actionCallback).row();
    });

    await ctx.reply(responseText, { reply_markup: keyboard });
});

async function updateAndRefreshMembersList(ctx: MyContext, groupId: number) {
    const members = await db.groupMember.findMany({
        where: { groupId },
        include: { user: true },
        orderBy: { user: { firstName: 'asc' } },
    });

    let responseText = ctx.t('members_status_list_updated') + '\n\n';
    const keyboard = new InlineKeyboard();

    members.forEach((member) => {
        const statusIcon = member.status === 'ACTIVE' ? '🟢' : '⚪️';
        const actionText = member.status === 'ACTIVE' ? ctx.t('deactivate_member_button') : ctx.t('activate_member_button');
        const actionCallback = member.status === 'ACTIVE' ? `deactivate_member:${member.userId}` : `activate_member:${member.userId}`;
        const userName = member.user.nickname ? `@${member.user.nickname}` : `${member.user.firstName} ${member.user.lastName || ''}`.trim();

        responseText += `${statusIcon} ${userName}\n`;
        keyboard.text(actionText, actionCallback).row();
    });

    await ctx.editMessageText(responseText, { reply_markup: keyboard });
}

bot.callbackQuery(/deactivate_member:(\d+)/, async (ctx) => {
    const userId = parseInt(ctx.match[1]!, 10);
    const groupId = ctx.chat?.id;

    if (!groupId) return;

    await db.groupMember.update({
        where: { userId_groupId: { userId, groupId } },
        data: { status: 'INACTIVE' },
    });
    
    await ctx.answerCallbackQuery({ text: ctx.t('member_deactivated') });
    await updateAndRefreshMembersList(ctx, groupId);
});

bot.callbackQuery(/activate_member:(\d+)/, async (ctx) => {
    const userId = parseInt(ctx.match[1]!, 10);
    const groupId = ctx.chat?.id;

    if (!groupId) return;

    await db.groupMember.update({
        where: { userId_groupId: { userId, groupId } },
        data: { status: 'ACTIVE' },
    });
    
    await ctx.answerCallbackQuery({ text: ctx.t('member_activated') });
    await updateAndRefreshMembersList(ctx, groupId);
});

bot.command('balance', async (ctx) => {
    if (!ctx.chat || ctx.chat.type === 'private') {
        await ctx.reply(ctx.t('command_only_works_in_groups'));
        return;
    }

    const transactions = await calculateGroupBalance(ctx.chat.id);

    if (transactions.length === 0) {
        await ctx.reply(ctx.t('everyone_settled_up'));
        return;
    }

    const group = await db.group.findUnique({ where: { id: ctx.chat.id } });
    const currencySymbols: { [key: string]: string } = { USD: '$', EUR: '€', RUB: '₽' };
    const currencySymbol = currencySymbols[group?.currency ?? 'USD'] || group?.currency || '';
    
    let responseText = '📊 Баланс группы:\n\n';

    for (const trans of transactions) {
        const fromUser = await db.user.findUnique({ where: { id: trans.from } });
        const toUser = await db.user.findUnique({ where: { id: trans.to } });
        
        const fromName = fromUser?.nickname ? `@${fromUser.nickname}` : fromUser?.firstName ?? 'Unknown';
        const toName = toUser?.nickname ? `@${toUser.nickname}` : toUser?.firstName ?? 'Unknown';
        const amountForDisplay = (trans.amount / 100).toFixed(2);

        responseText += `${fromName} должен ${toName} ${amountForDisplay}${currencySymbol}\n`;
    }
    
    await ctx.reply(responseText);
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

    if (expense.payerId !== BigInt(ctx.from.id)) {
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
    const amountInMajorUnits = parseFloat(amountRaw?.replace(',', '.') ?? '');
    
    if (isNaN(amountInMajorUnits) || amountInMajorUnits <= 0) {
        return;
    }
    
    const amount = Math.round(amountInMajorUnits * 100);
    const description = parts.slice(1).join(' ');

    const result = addExpenseSchema.safeParse({
        amount,
        description,
        payerId: BigInt(ctx.from.id),
    });

    if (!result.success) {
        // Don't reply if the edit is invalid. The user might be in the middle of typing.
        // Just ignore the invalid edit.
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

bot.on('message:text', (ctx) => {
    // In groups, we don't want to reply to every message.
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        return; // Just ignore non-command text messages in groups.
    }

    // In private chats, we can send a help message or an "unknown command" reply.
    return ctx.reply(ctx.t('unknown'));
});

run(bot);
