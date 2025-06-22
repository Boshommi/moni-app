import type { User } from '@/generated/prisma';
import { Context as DefaultContext } from 'grammy';

export interface AppContext extends DefaultContext {
    user: User;
} 
