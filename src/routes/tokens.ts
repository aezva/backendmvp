import { Router, Request, Response } from 'express';
import { TokenService } from '../services/tokenService';

const router = Router();

// GET /nnia/tokens/usage/:clientId
router.get('/usage/:clientId', async (req: Request, res: Response) => {
  const { clientId } = req.params;
  const { monthYear } = req.query;

  if (!clientId) {
    return res.status(400).json({ error: 'Client ID es requerido' });
  }

  try {
    const usage = await TokenService.getTokenUsageBySource(
      clientId, 
      monthYear as string
    );
    res.json({ usage });
  } catch (error) {
    console.error('Error getting token usage:', error);
    res.status(500).json({ error: 'Error obteniendo uso de tokens' });
  }
});

// GET /nnia/tokens/summary/:clientId
router.get('/summary/:clientId', async (req: Request, res: Response) => {
  const { clientId } = req.params;

  if (!clientId) {
    return res.status(400).json({ error: 'Client ID es requerido' });
  }

  try {
    const summary = await TokenService.getClientTokenSummary(clientId);
    if (!summary) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json({ summary });
  } catch (error) {
    console.error('Error getting token summary:', error);
    res.status(500).json({ error: 'Error obteniendo resumen de tokens' });
  }
});

// POST /nnia/tokens/check
router.post('/check', async (req: Request, res: Response) => {
  const { clientId, estimatedTokens } = req.body;

  if (!clientId || !estimatedTokens) {
    return res.status(400).json({ error: 'Client ID y estimatedTokens son requeridos' });
  }

  try {
    const check = await TokenService.checkClientTokens(clientId, estimatedTokens);
    if (!check) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json({ check });
  } catch (error) {
    console.error('Error checking tokens:', error);
    res.status(500).json({ error: 'Error verificando tokens' });
  }
});

// POST /nnia/tokens/consume
router.post('/consume', async (req: Request, res: Response) => {
  const {
    clientId, 
    tokensToConsume, 
    source, 
    conversationId, 
    messageLength, 
    modelUsed = 'gpt-4'
  } = req.body;

  if (!clientId || !tokensToConsume || !source || !conversationId || !messageLength) {
    return res.status(400).json({ 
      error: 'Todos los campos son requeridos: clientId, tokensToConsume, source, conversationId, messageLength' 
    });
  }

  try {
    const success = await TokenService.consumeClientTokens(
      clientId,
      tokensToConsume,
      source,
      conversationId,
      messageLength,
      modelUsed
    );

    if (!success) {
      return res.status(402).json({ 
        error: 'Tokens insuficientes',
        message: 'No tienes suficientes tokens para completar esta acción'
      });
    }

    res.json({ success: true, message: 'Tokens consumidos exitosamente' });
  } catch (error) {
    console.error('Error consuming tokens:', error);
    res.status(500).json({ error: 'Error consumiendo tokens' });
  }
});

// POST /nnia/tokens/estimate
router.post('/estimate', async (req: Request, res: Response) => {
  const { messageLength } = req.body;

  if (!messageLength) {
    return res.status(400).json({ error: 'messageLength es requerido' });
  }

  try {
    const estimatedTokens = TokenService.estimateTokens(messageLength);
    res.json({ estimatedTokens });
  } catch (error) {
    console.error('Error estimating tokens:', error);
    res.status(500).json({ error: 'Error estimando tokens' });
  }
});

// GET /nnia/tokens/limits/:plan
router.get('/limits/:plan', async (req: Request, res: Response) => {
  const { plan } = req.params;

  if (!plan) {
    return res.status(400).json({ error: 'Plan es requerido' });
  }

  try {
    const limit = TokenService.getPlanLimits(plan);
    res.json({ plan, limit });
  } catch (error) {
    console.error('Error getting plan limits:', error);
    res.status(500).json({ error: 'Error obteniendo límites del plan' });
  }
});

export default router; 