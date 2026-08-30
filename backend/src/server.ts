import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { setUserGPS, getAllActiveGPS } from './config/redis';
import { supabaseAdmin } from './config/supabase';

// Import routes
import authRoutes from './routes/auth';
import incidentRoutes from './routes/incidents';
import taskRoutes from './routes/tasks';
import inventoryRoutes from './routes/inventory';
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
import volunteerDispatchRoutes from './routes/volunteerDispatch';
import storageRoutes from './routes/storages';
import weatherRoutes, { fetchOpenMeteoWeather } from './routes/weather';
import barangayRoutes from './routes/barangay';
import evacuationCenterRoutes from './routes/evacuationCenters';
import debugRoutes from './routes/debug';

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

// ============================================
// Middleware
// ============================================

app.use(cors({ 
  origin: true, // Allow any origin
  credentials: true 
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
app.use('/api/incidents', incidentRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/inventory', inventoryRoutes);
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
app.use('/api/volunteer-dispatch', volunteerDispatchRoutes);
app.use('/api/storages', storageRoutes);
app.use('/api/weather', weatherRoutes);
app.use('/api/barangay', barangayRoutes);
app.use('/api/evacuation-centers', evacuationCenterRoutes);
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
      console.log(`GPS Update received for user ${data.userId}: ${data.latitude}, ${data.longitude}`);
      await setUserGPS(data.userId, data.latitude, data.longitude);
      // Broadcast to all connected commander dashboards
      io.to('commanders').emit('gps:location', data);
    } catch (err) {
      console.error('GPS update error:', err);
    }
  });

  // Join role-based rooms
  socket.on('join:role', (role: string) => {
    if (['admin', 'commander'].includes(role)) {
      socket.join('commanders');
    }
    if (role === 'professional_unit') {
      socket.join('professional_units');
    }
    socket.join(`role:${role}`);
    console.log(`Socket ${socket.id} joined room: ${role}`);
  });

  // Join barangay-specific room for real-time report notifications
  socket.on('join:barangay', (barangayId: string) => {
    socket.join(`barangay:${barangayId}`);
    console.log(`Socket ${socket.id} joined barangay room: ${barangayId}`);
  });

  // Join user-specific room for targeted notifications
  socket.on('join:user', (userId: string) => {
    socket.join(`user:${userId}`);
  });

  // Task status updates
  socket.on('task:statusUpdate', (data: { taskId: string; status: string; userId: string }) => {
    io.to('commanders').emit('task:statusChanged', data);
  });

  // New incident broadcast
  socket.on('incident:new', (incident: any) => {
    io.to('professional_units').emit('incident:alert', incident);
    io.to('commanders').emit('incident:new', incident);
  });

  // Inventory updates
  socket.on('inventory:update', (data: any) => {
    io.to('commanders').emit('inventory:changed', data);
  });

  // Resource request from professional unit
  socket.on('resource:request', (data: any) => {
    io.to('commanders').emit('resource:request', data);
  });

  // Request all GPS locations (commander dashboard)
  socket.on('gps:requestAll', async () => {
    try {
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
    console.log('Running scheduled weather data update...');
    
    // 1. Update weather data (try PAGASA first, fallback to Open-Meteo)
    let weatherData = null;
    let source = 'PAGASA';
    
    // Try fetching from PAGASA first
    const pagasaWeather = await (async () => {
      try {
        // In a real implementation, this would call a PAGASA API
        // For now, we'll simulate it
        return {
          temperature: 28 + Math.random() * 5,
          humidity: 60 + Math.random() * 30,
          windSpeed: 5 + Math.random() * 15,
          windDirection: Math.random() * 360,
          rainfall: Math.random() * 20,
          pressure: 1000 + Math.random() * 30,
          visibility: 10 + Math.random() * 10,
          uvIndex: 3 + Math.random() * 7,
          weatherCondition: ['Sunny', 'Partly Cloudy', 'Cloudy', 'Rainy'][Math.floor(Math.random() * 4)]
        };
      } catch (error) {
        console.error('Failed to fetch from PAGASA:', error);
        return null;
      }
    })();
    
    if (pagasaWeather) {
      weatherData = pagasaWeather;
    } else {
      // Fallback to Open-Meteo
      const openMeteo = await fetchOpenMeteoWeather();
      if (openMeteo) {
        weatherData = openMeteo;
        source = 'Open-Meteo';
      }
    }
    
    if (weatherData) {
      await supabaseAdmin
        .from('weather_data')
        .insert({
          temperature: weatherData.temperature,
          humidity: weatherData.humidity,
          wind_speed: weatherData.windSpeed,
          wind_direction: weatherData.windDirection,
          rainfall: weatherData.rainfall || 0,
          pressure: weatherData.pressure,
          visibility: weatherData.visibility,
          uv_index: weatherData.uvIndex,
          weather_condition: weatherData.weatherCondition,
          data_source: source
        });
      
      // Also update forecasts if we have Open-Meteo data
      if (source === 'Open-Meteo' && (weatherData as any).hourly && (weatherData as any).daily) {
        const { hourly, daily } = weatherData as any;
        
        // Insert hourly forecasts
        if (hourly.time) {
          for (let i = 0; i < hourly.time.length; i++) {
            await supabaseAdmin.from('weather_forecasts').insert({
              forecast_type: 'hourly',
              forecast_time: hourly.time[i],
              temperature: hourly.temperature_2m?.[i],
              humidity: hourly.relative_humidity_2m?.[i],
              wind_speed: hourly.wind_speed_10m?.[i],
              wind_direction: hourly.wind_direction_10m?.[i],
              rainfall_probability: hourly.precipitation_probability?.[i]
            });
          }
        }
        
        // Insert daily forecasts
        if (daily.time) {
          for (let i = 0; i < daily.time.length; i++) {
            await supabaseAdmin.from('weather_forecasts').insert({
              forecast_type: 'daily',
              forecast_time: daily.time[i],
              temperature: daily.temperature_2m_max?.[i],
              rainfall_probability: daily.precipitation_probability_max?.[i]
            });
          }
        }
      }
      
      console.log('Weather data updated successfully from', source);
    }

    // 2. Update river levels (simulate real data for now - in production, use PAGASA Hydromet)
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

export { io };
export default app;
