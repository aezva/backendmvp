import { supabase } from './supabase';

export interface TokenUsage {
  source: string;
  tokens_used: number;
  conversation_count: number;
  avg_tokens_per_conversation: number;
}

export interface TokenSummary {
  plan: string;
  tokens_remaining: number;
  tokens_used_this_month: number;
  tokens_bought_separately: number;
  total_tokens_available: number;
  usage_percentage: number;
  current_period_end: string;
}

export interface TokenCheck {
  has_sufficient_tokens: boolean;
  tokens_remaining: number;
  tokens_needed: number;
}

export class TokenService {
  // Obtener uso de tokens por fuente
  static async getTokenUsageBySource(clientId: string, monthYear?: string): Promise<TokenUsage[]> {
    try {
      const { data, error } = await supabase
        .rpc('get_token_usage_by_source', {
          p_client_id: clientId,
          p_month_year: monthYear
        });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error getting token usage by source:', error);
      throw error;
    }
  }

  // Obtener resumen de tokens del cliente
  static async getClientTokenSummary(clientId: string): Promise<TokenSummary | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_client_token_summary', {
          p_client_id: clientId
        });

      if (error) throw error;
      return data?.[0] || null;
    } catch (error) {
      console.error('Error getting client token summary:', error);
      throw error;
    }
  }

  // Verificar si el cliente tiene tokens suficientes
  static async checkClientTokens(clientId: string, estimatedTokens: number): Promise<TokenCheck | null> {
    try {
      const { data, error } = await supabase
        .rpc('check_client_tokens', {
          p_client_id: clientId,
          p_estimated_tokens: estimatedTokens
        });

      if (error) throw error;
      return data?.[0] || null;
    } catch (error) {
      console.error('Error checking client tokens:', error);
      throw error;
    }
  }

  // Consumir tokens del cliente
  static async consumeClientTokens(
    clientId: string,
    tokensToConsume: number,
    source: string,
    conversationId: string,
    messageLength: number,
    modelUsed: string = 'gpt-4'
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .rpc('consume_client_tokens', {
          p_client_id: clientId,
          p_tokens_to_consume: tokensToConsume,
          p_source: source,
          p_conversation_id: conversationId,
          p_message_length: messageLength,
          p_model_used: modelUsed
        });

      if (error) throw error;
      return data || false;
    } catch (error) {
      console.error('Error consuming client tokens:', error);
      throw error;
    }
  }

  // Estimar tokens basado en longitud del mensaje
  static estimateTokens(messageLength: number): number {
    // Estimación aproximada: 1.3 tokens por palabra promedio
    // Una palabra promedio tiene ~4.5 caracteres
    const estimatedWords = messageLength / 4.5;
    return Math.ceil(estimatedWords * 1.3);
  }

  // Obtener límites de tokens por plan
  static getPlanLimits(plan: string): number {
    const limits = {
      basic: 100,
      pro: 4000,
      premium: 100000
    };
    return limits[plan as keyof typeof limits] || 100;
  }

  // Verificar si el cliente puede usar el servicio
  static async canClientUseService(clientId: string, estimatedTokens: number): Promise<boolean> {
    try {
      const tokenCheck = await this.checkClientTokens(clientId, estimatedTokens);
      return tokenCheck?.has_sufficient_tokens || false;
    } catch (error) {
      console.error('Error checking if client can use service:', error);
      return false;
    }
  }
} 