import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import stripeModule from 'stripe';
import { createClient } from '@supabase/supabase-js';
import nniaRoutes from './routes/nnia';

const stripe = new stripeModule(process.env.STRIPE_SECRET_KEY!);

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

app.use(cors());
app.use(bodyParser.json());

// Endpoints Stripe y SaaS
// ... (copiar aquí todos los endpoints de backend/server.js)
// ... existing code ...
app.use('/nnia', nniaRoutes);

app.listen(PORT, () => {
  console.log(`Servidor NNIA escuchando en puerto ${PORT}`);
}); 