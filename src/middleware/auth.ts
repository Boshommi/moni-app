import { db } from '@/boot/db';
import type { AppContext } from '@/types/context';

export const auth = async (ctx: AppContext, next: () => Promise<void>) => {
    let user = await db.user.findUnique({
        where: {
            id: ctx.from?.id,
        },
    });

    if (!user && ctx.from?.id) {
        user = await db.user.create({
            data: {
                id: ctx.from?.id,
                nickname: ctx.from?.username,
            },
        });
    }

    ctx.user = user!;

    await next();
};
