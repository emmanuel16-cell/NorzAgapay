import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  enableDebugQuickLogin: process.env.ENABLE_DEBUG_QUICK_LOGIN === 'true',

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // Upstash Redis
  upstashRedisUrl: process.env.UPSTASH_REDIS_URL || '',
  upstashRedisToken: process.env.UPSTASH_REDIS_TOKEN || '',

  // Supabase Storage
  supabaseBucketName: process.env.SUPABASE_BUCKET_NAME || 'norzagapay-files',

  // Mapbox
  mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN || '',
};
