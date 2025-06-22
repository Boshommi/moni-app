import { db } from '@/boot/db';
import type { MyContext } from '@/types/context';

export const auth = async (ctx: MyContext, next: () => Promise<void>) => {
    if (!ctx.from) {
        return;
    }

    const user = await db.user.upsert({
        where: { id: ctx.from.id },
        create: {
            id: ctx.from.id,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
            nickname: ctx.from.username,
        },
        update: {
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
            nickname: ctx.from.username,
        }
    });

    ctx.user = user;

    const chat = ctx.chat;
    if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
        // Ensure the group exists. It should have been created by the my_chat_member handler,
        // but this provides a fallback.
        await db.group.upsert({
            where: { id: chat.id },
            create: { id: chat.id, title: chat.title },
            update: { title: chat.title },
        });

        // Add user as a group member if they are not already.
        await db.groupMember.upsert({
            where: {
                userId_groupId: {
                    userId: user.id,
                    groupId: chat.id,
                }
            },
            create: {
                userId: user.id,
                groupId: chat.id,
            },
            update: {}, // Nothing to update if they already exist
        });
    }

    await next();
};
