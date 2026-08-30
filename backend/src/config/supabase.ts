import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from './index';

// Global options for both clients
const supabaseOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    headers: { 'x-application-name': 'norzagapay-backend' },
  },
  realtime: {
    transport: ws,
  } as any,
};

// Service role client - bypasses RLS, used for backend operations
export const supabaseAdmin = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  supabaseOptions
);

// Anon client - respects RLS, used for client-context operations
export const supabaseAnon = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  supabaseOptions
);
