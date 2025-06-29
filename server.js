const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Configuración de planes
const PLANS = {
  starter: {
    name: 'Starter',
    price: 19,
    tokens: 150000,
    priceId: 'price_1RdfNTP1x2coidHcaMps3STo'
  },
  pro: {
    name: 'Pro',
    price: 49,
    tokens: 500000,
    priceId: 'price_1RdfO7P1x2coidHcPT71SJlt'
  },
  ultra: {
    name: 'Ultra',
    price: 99,
    tokens: 1200000,
    priceId: 'price_1RdfOfP1x2coidHcln5m4KEi'
  }
};

const TOKEN_PACKS = {
  pack1: {
    name: '150K Tokens',
    price: 5,
    tokens: 150000,
    priceId: 'price_1RdfS0P1x2coidHcafwMvRba'
  },
  pack2: {
    name: '400K Tokens',
    price: 10,
    tokens: 400000,
    priceId: 'price_1RdfT4P1x2coidHcbpqY6Wjh'
  }
};

app.use(cors());
app.use(bodyParser.json());

// Endpoint para crear sesión de checkout
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { priceId, clientId, mode } = req.body;

    // Obtener información del cliente desde Supabase
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError) {
      return res.status(400).json({ error: 'Cliente no encontrado' });
    }

    // Crear o obtener customer de Stripe
    let stripeCustomerId = client.stripe_customer_id;
    
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: client.email,
        metadata: {
          client_id: clientId
        }
      });
      
      stripeCustomerId = customer.id;
      
      // Actualizar cliente en Supabase
      await supabase
        .from('clients')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', clientId);
    }

    // Crear sesión de checkout
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: mode, // 'subscription' o 'payment'
      success_url: `${req.headers.origin}/subscription?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/subscription?canceled=true`,
      metadata: {
        client_id: clientId,
        mode: mode
      }
    });

    res.json({ sessionId: session.id });
  } catch (error) {
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

    // Actualizar en Supabase
    await supabase
      .from('subscriptions')
      .update({ 
        status: 'canceled',
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
      })
      .eq('stripe_subscription_id', subscriptionId);

    res.json({ success: true, subscription });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para actualizar suscripción
app.post('/api/update-subscription', async (req, res) => {
  try {
    const { subscriptionId, newPriceId } = req.body;

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    // Actualizar suscripción en Stripe
    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        price: newPriceId,
      }],
      proration_behavior: 'create_prorations',
    });

    // Obtener información del nuevo plan
    const newPlan = Object.values(PLANS).find(plan => plan.priceId === newPriceId);

    // Actualizar en Supabase
    await supabase
      .from('subscriptions')
      .update({ 
        plan: newPlan.name,
        tokens_remaining: newPlan.tokens,
        current_period_start: new Date(updatedSubscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(updatedSubscription.current_period_end * 1000).toISOString()
      })
      .eq('stripe_subscription_id', subscriptionId);

    res.json({ success: true, subscription: updatedSubscription });
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para obtener historial de pagos
app.get('/api/payment-history', async (req, res) => {
  try {
    const { clientId } = req.query;

    // Obtener customer_id del cliente
    const { data: client } = await supabase
      .from('clients')
      .select('stripe_customer_id')
      .eq('id', clientId)
      .single();

    if (!client?.stripe_customer_id) {
      return res.json({ payments: [] });
    }

    // Obtener pagos de Stripe
    const payments = await stripe.paymentIntents.list({
      customer: client.stripe_customer_id,
      limit: 10
    });

    res.json({ payments: payments.data });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ error: error.message });
  }
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en el puerto ${PORT}`);
}); 