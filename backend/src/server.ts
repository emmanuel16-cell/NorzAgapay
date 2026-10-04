import path from 'path';
import express from 'express';
import cors from 'cors';
import http from 'http';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer } from 'socket.io';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { setUserGPS, getAllActiveGPS } from './config/redis';
import { supabaseAdmin } from './config/supabase';
import { DispatcherVerificationService } from './services/dispatcherVerificationService';

// Import routes
import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import verificationRoutes from './routes/verification';
import userRoutes from './routes/users';
import matchingRoutes from './routes/matching';
import blockedRouteRoutes from './routes/blockedRoutes';
import uploadRoutes from './routes/upload';
import reportRoutes from './routes/reports';
import incidentReportRoutes from './routes/incidentReports';
import requestRoutes from './routes/requests';
import dispatchUnitRoutes from './routes/dispatchUnits';
import officerRoutes from './routes/officers';
import respondUnitRoutes from './routes/respondUnits';
import storageRoutes from './routes/storages';
import weatherRoutes from './routes/weather';
import barangayRoutes from './routes/barangay';
import evacuationCenterRoutes from './routes/evacuationCenters';
import municipalityBoundaryRoutes from './routes/municipalityBoundary';
import debugRoutes from './routes/debug';
import broadcastRoutes from './routes/broadcasts';

// Helper to determine river level status
const getRiverLevelStatus = (level: number, warning: number, critical: number) => {
  if (level >= critical) return 'critical';
  if (level >= warning) return 'warning';
  return 'normal';
};

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new SocketIOServer(server, {
  cors: {
    origin: true, // Allow any origin for socket.io too
    methods: ['GET', 'POST'],
  },
});

function getSocketTokenPayload(socket: any): any | null {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string' || !token) return null;
  try {
    return jwt.verify(token, config.jwtSecret) as any;
  } catch (_) {
    return null;
  }
}

function normalizeSocketRole(role: string): string {
  const legacyRoleMap: Record<string, string> = {
    captain: 'dispatcher',
    team_leader: 'responder',
    volunteer: 'staff',
  };
  return legacyRoleMap[role] || role;
}

async function canUseBarangaySocket(socket: any): Promise<boolean> {
  const decoded = getSocketTokenPayload(socket);
  if (!decoded) return false;
  if (!decoded.barangayId) return true;
  const { data: account, error } = await supabaseAdmin
    .from('barangay_users')
    .select('role, is_active, barangay_id')
    .eq('id', decoded.userId)
    .maybeSingle();
  if (error || !account || account.is_active !== true || account.barangay_id !== decoded.barangayId) return false;
  if (normalizeSocketRole(account.role) !== normalizeSocketRole(decoded.role)) return false;
  return DispatcherVerificationService.isBarangayActive(decoded.barangayId);
}

// ============================================
// Middleware
// ============================================

app.use(cors({ 
  origin: true, // Allow any origin
  credentials: true 
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../data/uploads')));

// Rate limiting on login (Increased for development/testing)
const loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // Reduced to 1 minute for testing
  max: 100, // Increased to 100 attempts per IP
  message: { error: 'Too many login attempts. Try again in 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', loginLimiter);

// ============================================
// API Routes
// ============================================

app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/matching', matchingRoutes);
app.use('/api/blocked-routes', blockedRouteRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/incident-reports', incidentReportRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/dispatch-units', dispatchUnitRoutes);
app.use('/api/officers', officerRoutes);
app.use('/api/respond-units', respondUnitRoutes);
app.use('/api/storages', storageRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/barangay', barangayRoutes);
app.use('/api/broadcasts', broadcastRoutes);
app.use('/api/evacuation-centers', evacuationCenterRoutes);
app.use('/api/municipality-boundary', municipalityBoundaryRoutes);
app.use('/api/debug', debugRoutes);

// Health check
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// Socket.io Real-time Events
// ============================================

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // GPS location broadcast
  socket.on('gps:update', async (data: { userId: string; latitude: number; longitude: number }) => {
    try {
      if (!(await canUseBarangaySocket(socket))) return;
      console.log(`GPS Update received for user ${data.userId}: ${data.latitude}, ${data.longitude}`);
      await setUserGPS(data.userId, data.latitude, data.longitude);
      // Broadcast responder GPS updates to dashboard staff.
      io.to('dashboard_staff').emit('gps:location', data);
    } catch (err) {
      console.error('GPS update error:', err);
    }
  });

  // Only a signed command-center token may join dashboard role rooms. A
  // barangay dispatcher token must never gain dashboard-wide visibility.
  socket.on('join:role', (role: string) => {
    const decoded = getSocketTokenPayload(socket);
    if (!decoded || decoded.barangayId || normalizeSocketRole(decoded.role) !== role) return;
    if (['master_admin', 'admin', 'logistics', 'dispatcher'].includes(role)) {
      socket.join('dashboard_staff');
    }
    if (role === 'responder') {
      socket.join('responders');
    }
    socket.join(`role:${role}`);
    console.log(`Socket ${socket.id} joined room: ${role}`);
  });

  // Join the sensitive barangay room only for an active account in a barangay
  // with an active Barangay Account Request.
  socket.on('join:barangay', async (barangayId: string) => {
    try {
      const decoded = getSocketTokenPayload(socket);
      const role = decoded ? normalizeSocketRole(decoded.role) : '';
      if (!decoded || decoded.barangayId !== barangayId) return;

      const { data: account, error } = await supabaseAdmin
        .from('barangay_users')
        .select('role, is_active')
        .eq('id', decoded.userId)
        .eq('barangay_id', barangayId)
        .maybeSingle();
      if (error || !account || account.is_active !== true || normalizeSocketRole(account.role) !== role) return;
      if (!(await DispatcherVerificationService.isBarangayActive(barangayId))) return;

      socket.data.userId = decoded.userId;
      socket.data.barangayId = barangayId;
      socket.data.barangayRole = role;
      socket.join(`barangay:${barangayId}`);
      console.log(`Socket ${socket.id} joined authorized barangay room: ${barangayId}`);
    } catch (err) {
      console.error('Socket barangay room authorization failed:', err);
    }
  });

  // Account request status is safe to read while access is pending. This room
  // carries only activation-state events, never incident or report activity.
  socket.on('join:coordination', async (barangayId: string) => {
    try {
      const decoded = getSocketTokenPayload(socket);
      const role = decoded ? normalizeSocketRole(decoded.role) : '';
      if (!decoded || decoded.barangayId !== barangayId || !['admin', 'dispatcher', 'responder', 'staff'].includes(role)) return;
      const { data: account, error } = await supabaseAdmin
        .from('barangay_users')
        .select('role, is_active, barangay_id')
        .eq('id', decoded.userId)
        .maybeSingle();
      if (error || !account || account.is_active !== true || account.barangay_id !== barangayId || normalizeSocketRole(account.role) !== role) return;
      socket.join(`barangay:coordination:${barangayId}`);
    } catch (err) {
      console.error('Socket coordination room authorization failed:', err);
    }
  });

  // Join user-specific room for targeted notifications
  socket.on('join:user', (userId: string) => {
    const decoded = getSocketTokenPayload(socket);
    if (!decoded || decoded.userId !== userId) return;
    socket.join(`user:${userId}`);
  });

  // Task status updates
  socket.on('task:statusUpdate', (data: { taskId: string; status: string; userId: string }) => {
    void canUseBarangaySocket(socket).then((allowed) => {
      if (allowed) io.to('dashboard_staff').emit('task:statusChanged', data);
    });
  });

  // New incident broadcast
  socket.on('incident:new', (incident: any) => {
    void canUseBarangaySocket(socket).then((allowed) => {
      if (!allowed) return;
      io.to('responders').emit('incident:alert', incident);
      io.to('dashboard_staff').emit('incident:new', incident);
    });
  });

  // Resource request from professional unit
  socket.on('resource:request', (data: any) => {
    void canUseBarangaySocket(socket).then((allowed) => {
      if (allowed) io.to('dashboard_staff').emit('resource:request', data);
    });
  });

  // Request all GPS locations (dashboard staff)
  socket.on('gps:requestAll', async () => {
    try {
      if (!(await canUseBarangaySocket(socket))) return;
      const locations = await getAllActiveGPS();
      socket.emit('gps:allLocations', locations);
    } catch (err) {
      console.error('Get all GPS error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ============================================
// Scheduled Background Jobs
// ============================================

const runScheduledUpdates = async () => {
  try {
    console.log('Running scheduled river-level update...');

    // Update river levels (simulate real data for now - in production, use PAGASA Hydromet)
    const { data: stations } = await supabaseAdmin.from('river_stations').select('*').eq('active', true);
    if (stations) {
      for (const station of stations) {
        // Simulate realistic river level changes
        const { data: latestLevel } = await supabaseAdmin
          .from('river_levels')
          .select('*')
          .eq('station_id', station.id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .single();
        
        let newLevel: number;
        if (latestLevel) {
          // Small random variation around previous level
          newLevel = latestLevel.water_level + (Math.random() - 0.5) * 0.2;
        } else {
          // Start just below warning level
          newLevel = station.warning_level - 1 + Math.random() * 2;
        }
        
        const levelStatus = getRiverLevelStatus(newLevel, station.warning_level, station.critical_level);
        
        const trend = Math.random() > 0.5 ? 'rising' : (Math.random() > 0.5 ? 'falling' : 'steady');
        
        await supabaseAdmin
          .from('river_levels')
          .insert({
            station_id: station.id,
            water_level: newLevel,
            trend,
            level: levelStatus,
            recorded_at: new Date().toISOString(),
          });
        
        // Update station status
        await supabaseAdmin
          .from('river_stations')
          .update({ status: levelStatus })
          .eq('id', station.id);
        
        // Create advisory if needed
        if (levelStatus !== 'normal') {
          await supabaseAdmin
            .from('weather_advisories')
            .insert({
              title: `River Level Alert: ${station.station_name}`,
              type: 'flood',
              level: levelStatus,
              message: `Water level at ${station.station_name} has reached ${newLevel.toFixed(2)}m (${levelStatus.toUpperCase()} status). Warning: ${station.warning_level}m, Critical: ${station.critical_level}m.`,
              source: 'PAGASA Hydromet (Automatic)',
            });
        }
      }
      console.log('River level data updated successfully');
    }

    console.log('All scheduled updates completed');
  } catch (error) {
    console.error('Error in scheduled updates:', error);
  }
};

// Run initial update on server start
runScheduledUpdates();

// Run updates every 5 minutes (300,000 ms)
setInterval(runScheduledUpdates, 300000);

// ============================================
// Start Server
// ============================================

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`
    ╔══════════════════════════════════════════════╗
    ║         NorzAgapay Backend Server            ║
    ║══════════════════════════════════════════════║
    ║  Port:        ${config.port}                          ║
    ║  Environment: ${config.nodeEnv.padEnd(20)}       ║
    ║  CORS Origin: ${config.corsOrigin.padEnd(20)}║
    ║  Scheduled Updates: Every 5 minutes        ║
    ╚══════════════════════════════════════════════╝
    `);
  });
}

export { io };
export default app;
// Reloaded for dispatcher certification routes
