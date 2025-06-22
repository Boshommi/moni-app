import type { User } from '@/generated/prisma';
import type { Context, SessionFlavor } from 'grammy';
import type { I18nFlavor } from '@grammyjs/i18n';
import type { Conversation, ConversationFlavor } from '@grammyjs/conversations';

// This is the data that will be stored in the session.
export interface SessionData {
    expenseId?: number;
}

export type MyContext = ConversationFlavor<
    Context &
        SessionFlavor<SessionData> &
        I18nFlavor & {
            user: User;
        }
>;

// This is what the conversations will use
export type MyConversation = Conversation<MyContext, MyContext>;
