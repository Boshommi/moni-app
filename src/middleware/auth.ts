import { db } from '@/boot/db';
import { Context } from 'grammy';

export const auth = async (ctx: Context, next: () => Promise<void>) => {
    const user = await db.user.findUnique({
        where: {
            id: ctx.from?.id,
        },
    });

    if (!user && ctx.from?.id) {
        await db.user.create({
            data: {
                id: ctx.from?.id,
                nickname: ctx.from?.username,
            },
        });
    }

    await next();
};
