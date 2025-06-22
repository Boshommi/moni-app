import { db } from "@/boot/db";

// This function will calculate the balance for each member of a group.
export async function calculateGroupBalance(groupId: number) {
    // 1. Fetch all expenses for the group with participants
    const expenses = await db.expense.findMany({
        where: { groupId },
        include: { participants: true },
    });

    // 2. Calculate how much each person paid and how much they should have paid.
    const memberBalances: Map<bigint, number> = new Map();

    for (const expense of expenses) {
        const totalParticipants = expense.participants.length;
        if (totalParticipants === 0) continue;

        const sharePerPerson = expense.amount / totalParticipants;

        // Add to payer's balance
        memberBalances.set(expense.payerId, (memberBalances.get(expense.payerId) || 0) + expense.amount);

        // Subtract from each participant's balance
        for (const participant of expense.participants) {
            memberBalances.set(participant.id, (memberBalances.get(participant.id) || 0) - sharePerPerson);
        }
    }
    
    // 3. Separate members into debtors and creditors
    const debtors: { userId: bigint, amount: number }[] = [];
    const creditors: { userId: bigint, amount: number }[] = [];

    for (const [userId, balance] of memberBalances.entries()) {
        if (balance > 0) {
            creditors.push({ userId, amount: balance });
        } else if (balance < 0) {
            debtors.push({ userId, amount: -balance });
        }
    }
    
    // 4. Minimize transactions
    const transactions: { from: bigint, to: bigint, amount: number }[] = [];
    
    let i = 0;
    let j = 0;
    
    while (i < debtors.length && j < creditors.length) {
        const debtor = debtors[i]!;
        const creditor = creditors[j]!;
        const amountToSettle = Math.min(debtor.amount, creditor.amount);

        transactions.push({ from: debtor.userId, to: creditor.userId, amount: amountToSettle });

        debtor.amount -= amountToSettle;
        creditor.amount -= amountToSettle;

        if (debtor.amount < 0.01) { // Use a small epsilon for float comparison safety
            i++;
        }
        if (creditor.amount < 0.01) {
            j++;
        }
    }
    
    return transactions;
} 
