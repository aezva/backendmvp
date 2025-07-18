"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const body_parser_1 = __importDefault(require("body-parser"));
const stripe_1 = __importDefault(require("stripe"));
const supabase_js_1 = require("@supabase/supabase-js");
const nnia_1 = __importDefault(require("./routes/nnia"));
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY);
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey);
// Configuración de planes (actualizado a modo LIVE)
const PLANS = {
    starter: {
        name: 'Starter',
        priceId: 'price_1Rlr8LGmx15fN3tsakY4AVjH',
        tokens: 20000
    },
    pro: {
        name: 'Pro',
        priceId: 'price_1Rlr97Gmx15fN3tsINg8pjBW',
        tokens: 50000
    },
    business: {
        name: 'Business',
        priceId: 'price_1Rlr9iGmx15fN3tsXAwk7jPS',
        tokens: 150000
    }
};
const TOKEN_PACKS = {
    pack_20k: {
        name: '20,000 tokens',
        priceId: 'price_1RlrFDGmx15fN3tsGT1dKoI0',
        tokens: 20000
    },
    pack_50k: {
        name: '50,000 tokens',
        priceId: 'price_1RlrFjGmx15fN3tsRiGEGlfd',
        tokens: 50000
    },
    pack_150k: {
        name: '150,000 tokens',
        priceId: 'price_1RlrHmGmx15fN3tsT4S0pKse',
        tokens: 150000
    }
};
app.use((0, cors_1.default)());
app.use(body_parser_1.default.json());
// Endpoint para crear sesión de checkout
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { priceId, clientId, mode } = req.body;
        const { data: client, error: clientError } = await supabase
            .from('clients')
            .select('*')
            .eq('id', clientId)
            .single();
        if (clientError || !client) {
            return res.status(400).json({ error: 'Cliente no encontrado' });
        }
        let stripeCustomerId = client.stripe_customer_id;
        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: client.email,
                metadata: { client_id: clientId }
            });
            stripeCustomerId = customer.id;
            await supabase
                .from('clients')
                .update({ stripe_customer_id: stripeCustomerId })
                .eq('id', clientId);
        }
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            line_items: [
                { price: priceId, quantity: 1 },
            ],
            mode: mode,
            success_url: `${req.headers.origin}/subscription?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.headers.origin}/subscription?canceled=true`,
            metadata: { client_id: clientId, mode: mode },
            allow_promotion_codes: true
        });
        res.json({ sessionId: session.id });
    }
    catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: error.message });
    }
});
// Endpoint para cancelar suscripción
app.post('/api/cancel-subscription', async (req, res) => {
    try {
        const { subscriptionId } = req.body;
        const subscription = await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true
        });
        await supabase
            .from('subscriptions')
            .update({
            status: 'canceled',
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
        })
            .eq('stripe_subscription_id', subscriptionId);
        res.json({ success: true, subscription });
    }
    catch (error) {
        console.error('Error canceling subscription:', error);
        res.status(500).json({ error: error.message });
    }
});
// Endpoint para actualizar suscripción
app.post('/api/update-subscription', async (req, res) => {
    try {
        const { subscriptionId, newPriceId } = req.body;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
            items: [{
                    id: subscription.items.data[0].id,
                    price: newPriceId,
                }],
            proration_behavior: 'create_prorations',
        });
        const newPlan = Object.values(PLANS).find(plan => plan.priceId === newPriceId);
        await supabase
            .from('subscriptions')
            .update({
            plan: newPlan?.name,
            tokens_remaining: newPlan?.tokens,
            current_period_start: new Date(updatedSubscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(updatedSubscription.current_period_end * 1000).toISOString()
        })
            .eq('stripe_subscription_id', subscriptionId);
        res.json({ success: true, subscription: updatedSubscription });
    }
    catch (error) {
        console.error('Error updating subscription:', error);
        res.status(500).json({ error: error.message });
    }
});
// Endpoint para obtener historial de pagos
app.get('/api/payment-history', async (req, res) => {
    try {
        const { clientId } = req.query;
        const { data: client } = await supabase
            .from('clients')
            .select('stripe_customer_id')
            .eq('id', clientId)
            .single();
        if (!client?.stripe_customer_id) {
            return res.json({ payments: [] });
        }
        const payments = await stripe.paymentIntents.list({
            customer: client.stripe_customer_id,
            limit: 10
        });
        res.json({ payments: payments.data });
    }
    catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).json({ error: error.message });
    }
});
// Endpoint para recibir webhooks de Stripe
app.post('/api/stripe/webhook', body_parser_1.default.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        if (!sig)
            throw new Error('No signature header');
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    }
    catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const clientId = session.metadata?.client_id;
                const mode = session.metadata?.mode;
                if (mode === 'subscription' && session.subscription) {
                    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
                    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                    const plan = Object.values(PLANS).find(p => p.priceId === subscription.items.data[0].price.id);
                    await supabase.from('subscriptions').upsert([
                        {
                            client_id: clientId,
                            plan: plan ? plan.name : 'Starter',
                            status: subscription.status,
                            tokens_remaining: plan ? plan.tokens : 20000,
                            stripe_subscription_id: subscription.id,
                            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                            updated_at: new Date().toISOString()
                        }
                    ], { onConflict: 'client_id' });
                }
                if (mode === 'payment') {
                    // Buscar el pack por priceId en metadata o en line_items
                    let priceId = session.metadata?.priceId;
                    if (!priceId && session.line_items && Array.isArray(session.line_items.data) && session.line_items.data.length > 0) {
                        priceId = session.line_items.data[0].price.id;
                    }
                    const pack = priceId ? Object.values(TOKEN_PACKS).find(p => p.priceId === priceId) : undefined;
                    if (clientId && pack) {
                        await supabase.rpc('add_tokens_to_client', {
                            p_client_id: clientId,
                            p_tokens: pack.tokens
                        });
                        await supabase.from('token_purchases').insert({
                            client_id: clientId,
                            tokens_amount: pack.tokens,
                            price_paid: session.amount_total ? session.amount_total / 100 : null,
                            stripe_payment_intent_id: session.payment_intent,
                            status: 'completed',
                            created_at: new Date().toISOString()
                        });
                    }
                }
                break;
            }
            case 'invoice.paid': {
                const invoice = event.data.object;
                const subscriptionId = invoice.subscription;
                if (!subscriptionId)
                    break;
                const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                const clientId = subscription.metadata?.client_id;
                const plan = Object.values(PLANS).find(p => p.priceId === subscription.items.data[0].price.id);
                if (clientId && plan) {
                    await supabase.from('subscriptions').update({
                        tokens_remaining: plan.tokens,
                        tokens_used_this_month: 0,
                        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                        status: subscription.status,
                        updated_at: new Date().toISOString()
                    }).eq('client_id', clientId);
                }
                break;
            }
            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                const clientId = subscription.metadata?.client_id;
                const plan = Object.values(PLANS).find(p => p.priceId === subscription.items.data[0].price.id);
                if (clientId && plan) {
                    await supabase.from('subscriptions').update({
                        plan: plan.name,
                        tokens_remaining: plan.tokens,
                        status: subscription.status,
                        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                        updated_at: new Date().toISOString()
                    }).eq('client_id', clientId);
                }
                break;
            }
            case 'payment_intent.succeeded': {
                break;
            }
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }
        res.json({ received: true });
    }
    catch (err) {
        console.error('Error processing Stripe webhook:', err);
        res.status(500).send('Webhook handler failed');
    }
});
app.use('/nnia', nnia_1.default);
app.listen(PORT, () => {
    console.log(`Servidor NNIA escuchando en puerto ${PORT}`);
});
