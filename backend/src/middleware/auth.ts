import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { supabaseAdmin } from '../config/supabase';

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
  unitType?: string;
  barangayId?: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

/**
 * JWT authentication middleware.
 * Extracts and verifies JWT from Authorization header.
 */
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Provide a valid Bearer token.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  let decoded: AuthPayload;
  try {
    decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }

  try {
    // Barangay sessions use their own account lookup and barangay-wide
    // activation gate in authenticateBarangay. Never let their overlapping
    // `admin` / `dispatcher` role names authorize command-center APIs.
    if (decoded.barangayId) {
      res.status(403).json({ error: 'Use a barangay account endpoint for this session.' });
      return;
    }

    if (decoded.role === 'resident') {
      const { data: resident, error } = await supabaseAdmin
        .from('resident_user')
        .select('status')
        .eq('id', decoded.userId)
        .maybeSingle();
      if (error) {
        res.status(503).json({ error: 'Unable to verify resident account status.' });
        return;
      }
      if (!resident || resident.status !== 'active') {
        res.status(403).json({ error: 'This resident account is not active.' });
        return;
      }
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.error('Authentication account check failed:', err);
    res.status(503).json({ error: 'Unable to verify account status.' });
    return;
  }
}

/**
 * Role-based access control middleware.
 * Restricts access to users with specific roles.
 */
export function authorize(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (req.user.role !== 'master_admin' && !allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions. Access denied.' });
      return;
    }

    next();
  };
}
