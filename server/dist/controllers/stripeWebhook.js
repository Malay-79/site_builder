import Stripe from 'stripe';
import prisma from '../lib/prisma.js';
export const stripeWebhook = async (request, response) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (endpointSecret) {
        // Get the signature sent by Stripe
        const signature = request.headers['stripe-signature'];
        let event;
        try {
            event = stripe.webhooks.constructEvent(request.body, signature, endpointSecret);
        }
        catch (err) {
            console.log(`⚠️ Webhook signature verification failed.`, err.message);
            return response.sendStatus(400);
        }
        // Handle the event
        switch (event.type) {
            case 'payment_intent.succeeded':
                const paymentIntent = event.data.object;
                const sessionList = await stripe.checkout.sessions.list({
                    payment_intent: paymentIntent.id
                });
                const session = sessionList.data[0];
                const { transactionId, appId } = session.metadata;
                if (appId === 'ai-site-builder' && transactionId) {
                    const transaction = await prisma.transaction.update({
                        where: { id: transactionId },
                        data: { isPaid: true }
                    });
                    // Add the credits to the user data
                    await prisma.user.update({
                        where: { id: transaction.userId },
                        data: { credits: { increment: transaction.credits } }
                    });
                }
                break;
            default:
                console.log(`Unhandled event type ${event.type}`);
        }
        // Return a response to acknowledge receipt of the event
        response.json({ received: true });
    }
};
