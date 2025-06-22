import { createConversation } from "@grammyjs/conversations";
import { editExpenseConversation } from "./editExpense";
import { bot } from "@/boot/bot";

export const installConversations = () => {
    bot.use(createConversation(editExpenseConversation, "editExpense"));
} 
