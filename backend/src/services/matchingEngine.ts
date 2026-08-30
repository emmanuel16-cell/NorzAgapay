/**
 * NorzAgapay Matching Engine
 * 
 * This is the academic core of the system. It implements a multi-tier
 * responder matching algorithm that classifies incidents, identifies
 * appropriate professional units and volunteers, and coordinates
 * dynamic routing with obstacle avoidance.
 * 
 * Algorithm Steps:
 * 1. Classify incident → determine required skills
 * 2. Scan professional units → dispatch closest matching units
 * 3. Scan certified specialists → match by skill within 5km radius
 * 4. Scan general labor volunteers → assign non-specialized tasks within 5km
 * 5. Dynamic routing → Mapbox Directions with blocked route avoidance
 * 6. Logistics trigger → auto-flag relief goods for mobilization
 */

import { supabaseAdmin } from '../config/supabase';
import { config } from '../config';
import { getAllActiveGPS } from '../config/redis';
import fs from 'fs';
import path from 'path';

// ============================================
// Haversine Distance Calculation
// ============================================

/**
 * Calculate distance between two GPS coordinates using Haversine formula.
 * Returns distance in kilometers.
 */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

// ============================================
// Incident Classification
// ============================================

interface SkillRequirement {
  primarySkills: string[];
  requiresProfessionalUnit: boolean;
  unitTypes: string[];
  requiresRelief: boolean;
}

/**
 * Classify incident type and determine required skills,
 * professional unit types, and logistics needs.
 */
export function classifyIncident(incidentType: string): SkillRequirement {
  switch (incidentType) {
    case 'flash_flood':
      return {
        primarySkills: ['Water Rescue', 'EMT', 'Swift Water Rescue'],
        requiresProfessionalUnit: true,
        unitTypes: [
          'Rescue Officer', 
          'Swift Water Rescue Officer', 
          'Emergency Medical Responder (EMR)', 
          'Ambulance Officer / EMS Personnel', 
          'fire', 
          'medical'
        ],
        requiresRelief: true,
      };
    case 'fire':
      return {
        primarySkills: ['Firefighting', 'Medical', 'EMT', 'Hazmat'],
        requiresProfessionalUnit: true,
        unitTypes: [
          'Fire Response Officer', 
          'Rescue Officer', 
          'Emergency Medical Responder (EMR)', 
          'Ambulance Officer / EMS Personnel', 
          'fire', 
          'medical', 
          'police'
        ],
        requiresRelief: false,
      };
    case 'earthquake':
      return {
        primarySkills: ['Search and Rescue', 'EMT', 'Structural Assessment'],
        requiresProfessionalUnit: true,
        unitTypes: [
          'Rescue Officer', 
          'Mountain Rescue Officer', 
          'Emergency Medical Responder (EMR)', 
          'Ambulance Officer / EMS Personnel', 
          'Damage Assessment Officer', 
          'fire', 
          'medical', 
          'police'
        ],
        requiresRelief: true,
      };
    case 'medical_emergency':
      return {
        primarySkills: ['EMT', 'Paramedic', 'First Aid', 'Medical'],
        requiresProfessionalUnit: true,
        unitTypes: [
          'Emergency Medical Responder (EMR)', 
          'Ambulance Officer / EMS Personnel', 
          'medical'
        ],
        requiresRelief: false,
      };
    case 'typhoon':
      return {
        primarySkills: ['Evacuation Management', 'EMT', 'Water Rescue'],
        requiresProfessionalUnit: true,
        unitTypes: [
          'Rescue Officer', 
          'Evacuation Officer', 
          'Logistics Response Officer', 
          'Communications Officer', 
          'Safety & Security Officer', 
          'Traffic & Road Clearing Officer', 
          'police', 
          'fire', 
          'medical'
        ],
        requiresRelief: true,
      };
    case 'other':
    default:
      return {
        primarySkills: [],
        requiresProfessionalUnit: false,
        unitTypes: [],
        requiresRelief: false,
      };
  }
}

// ============================================
// Matching Engine Results
// ============================================

export interface MatchResult {
  dispatchedProfessionalUnits: DispatchedUnit[];
  matchedSpecialists: MatchedVolunteer[];
  assignedGeneralLabor: MatchedVolunteer[];
  createdTasks: string[];
  logisticsTriggered: boolean;
  logisticsDetails?: string;
}

interface DispatchedUnit {
  userId: string;
  fullName: string;
  unitType: string;
  distanceKm: number;
  taskId?: string;
}

interface MatchedVolunteer {
  userId: string;
  fullName: string;
  role: string;
  distanceKm: number;
  matchedSkill?: string;
  taskId?: string;
}

// ============================================
// Main Matching Function
// ============================================

export async function matchRespondersToIncident(incidentId: string, unitId?: string): Promise<MatchResult> {
  const result: MatchResult = {
    dispatchedProfessionalUnits: [],
    matchedSpecialists: [],
    assignedGeneralLabor: [],
    createdTasks: [],
    logisticsTriggered: false,
  };

  // 1. Fetch incident details
  const { data: incident, error: incidentError } = await supabaseAdmin
    .from('incidents')
    .select('*')
    .eq('id', incidentId)
    .single();

  if (incidentError || !incident) {
    throw new Error(`Incident not found: ${incidentId}`);
  }

  const incidentLat = incident.latitude;
  const incidentLng = incident.longitude;

  // 1c. Fetch latest GPS locations from Redis for real-time accuracy
  const activeGpsLocations = await getAllActiveGPS();
  const gpsMap = new Map(activeGpsLocations.map(loc => [loc.userId, loc]));

  // 1b. If unitId is provided, fetch personnel from that unit
  let preSelectedPersonnelIds: string[] = [];
  let unitName = 'Unit';

  if (unitId) {
    const { data: respondUnit, error: unitError } = await supabaseAdmin
      .from('respond_units')
      .select('*')
      .eq('id', unitId)
      .single();

    if (!unitError && respondUnit) {
      unitName = respondUnit.unit_name;
      
      // Get all real officers from users table
      const { data: allOfficers } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('role', 'professional_unit')
        .eq('status', 'active');
      
      if (allOfficers && allOfficers.length > 0) {
        preSelectedPersonnelIds = allOfficers.map(u => u.id);
        console.log(`Manual dispatch: Tasking all ${preSelectedPersonnelIds.length} active MDRRMO officers for mission ${incidentId}`);
      }
    }
  }

  // 2. Classify incident
  const classification = classifyIncident(incident.type);

  // ============================================
  // STEP 2: Scan for Professional Units
  // ============================================

  if (classification.requiresProfessionalUnit || preSelectedPersonnelIds.length > 0) {
    const query = supabaseAdmin
      .from('users')
      .select('id, full_name, role, unit_type, latitude, longitude')
      .eq('status', 'active');

    // If we have pre-selected personnel, we prioritize them. 
    // Otherwise we filter by role and type as usual.
    if (preSelectedPersonnelIds.length > 0) {
      query.in('id', preSelectedPersonnelIds);
    } else {
      query.eq('role', 'professional_unit').in('unit_type', classification.unitTypes);
    }

    const { data: personnel } = await query;

    if (personnel && personnel.length > 0) {
      // Calculate distance (prioritize Redis GPS data) and sort
      const unitsWithDistance = personnel
        .map((u) => {
          const redisGps = gpsMap.get(u.id);
          const lat = redisGps?.latitude ?? u.latitude;
          const lng = redisGps?.longitude ?? u.longitude;
          
          if (lat === null || lng === null) return null;
          
          return {
            ...u,
            distance: haversineDistance(incidentLat, incidentLng, lat, lng),
          };
        })
        .filter((u): u is any => u !== null)
        .sort((a, b) => a.distance - b.distance);

      // If pre-selected, dispatch ALL of them. If auto-matching, dispatch top 3.
      const topUnits = preSelectedPersonnelIds.length > 0 ? unitsWithDistance : unitsWithDistance.slice(0, 3);

      for (const unit of topUnits) {
        // Create a task for each dispatched unit
        const { data: task } = await supabaseAdmin
          .from('tasks')
          .insert({
            incident_id: incidentId,
            title: `${incident.type.replace('_', ' ').toUpperCase()} Response - ${unitName.toUpperCase()}`,
            description: `Emergency dispatch with unit ${unitName}. Incident: ${incident.title} at ${incident.address || 'incident location'}.`,
            task_type: 'specialist',
            required_skill: unit.unit_type || undefined,
            assigned_to: unit.id,
            status: 'pending',
            latitude: incidentLat,
            longitude: incidentLng,
            address: incident.address,
          })
          .select('id')
          .single();

        if (unit.role === 'professional_unit') {
          result.dispatchedProfessionalUnits.push({
            userId: unit.id,
            fullName: unit.full_name,
            unitType: unit.unit_type || 'unknown',
            distanceKm: Math.round(unit.distance * 100) / 100,
            taskId: task?.id,
          });
        } else if (unit.role === 'volunteer_specialist') {
          result.matchedSpecialists.push({
            userId: unit.id,
            fullName: unit.full_name,
            role: unit.role,
            distanceKm: Math.round(unit.distance * 100) / 100,
            taskId: task?.id,
          });
        } else {
          result.assignedGeneralLabor.push({
            userId: unit.id,
            fullName: unit.full_name,
            role: unit.role,
            distanceKm: Math.round(unit.distance * 100) / 100,
            taskId: task?.id,
          });
        }

        if (task) result.createdTasks.push(task.id);
      }
    }
  }

  // Skip step 3 and 4 if we already used manual unit dispatch to avoid double-dispatching
  if (preSelectedPersonnelIds.length > 0) {
    return result;
  }

  // ============================================
  // STEP 3: Scan for Certified Specialists (within 5km)
  // ============================================

  if (classification.primarySkills.length > 0) {
    // Query verified specialists
    const { data: specialists } = await supabaseAdmin
      .from('users')
      .select(`
        id, full_name, latitude, longitude,
        certifications(cert_type, verified)
      `)
      .eq('role', 'volunteer_specialist')
      .eq('verified', true)
      .eq('status', 'active');

    if (specialists && specialists.length > 0) {
      // Filter by distance (≤5km) and matching certifications
      const matchedSpecialists = specialists
        .map((s) => {
          const redisGps = gpsMap.get(s.id);
          const lat = redisGps?.latitude ?? s.latitude;
          const lng = redisGps?.longitude ?? s.longitude;
          
          if (lat === null || lng === null) return null;

          const distance = haversineDistance(incidentLat, incidentLng, lat, lng);
          const certs = (s.certifications as Array<{ cert_type: string; verified: boolean }>) || [];
          const matchingCert = certs.find(
            (c) => c.verified && classification.primarySkills.some(
              (skill) => c.cert_type.toLowerCase().includes(skill.toLowerCase())
            )
          );
          return {
            ...s,
            distance,
            matchingCert: matchingCert?.cert_type,
          };
        })
        .filter((s): s is any => s !== null && s.distance <= 5 && !!s.matchingCert)
        .sort((a, b) => a.distance - b.distance);

      // Send task request to top 5 matches
      const topSpecialists = matchedSpecialists.slice(0, 5);

      for (const spec of topSpecialists) {
        const { data: task } = await supabaseAdmin
          .from('tasks')
          .insert({
            incident_id: incidentId,
            title: `Specialist Response: ${spec.matchingCert}`,
            description: `Specialist deployment for ${incident.title} at ${incident.address || 'incident location'}`,
            task_type: 'specialist',
            required_skill: spec.matchingCert,
            assigned_to: spec.id,
            status: 'pending',
            latitude: incidentLat,
            longitude: incidentLng,
            address: incident.address,
          })
          .select('id')
          .single();

        result.matchedSpecialists.push({
          userId: spec.id,
          fullName: spec.full_name,
          role: 'volunteer_specialist',
          distanceKm: Math.round(spec.distance * 100) / 100,
          matchedSkill: spec.matchingCert,
          taskId: task?.id,
        });

        if (task) result.createdTasks.push(task.id);
      }
    }
  }

  // ============================================
  // STEP 4: Scan for General Labor Volunteers (within 5km)
  // ============================================

  const { data: generalVolunteers } = await supabaseAdmin
    .from('users')
    .select('id, full_name, latitude, longitude')
    .eq('role', 'volunteer_general')
    .eq('status', 'active');

  if (generalVolunteers && generalVolunteers.length > 0) {
    const nearbyGeneralLabor = generalVolunteers
      .map((v) => {
        const redisGps = gpsMap.get(v.id);
        const lat = redisGps?.latitude ?? v.latitude;
        const lng = redisGps?.longitude ?? v.longitude;
        
        if (lat === null || lng === null) return null;

        return {
          ...v,
          distance: haversineDistance(incidentLat, incidentLng, lat, lng),
        };
      })
      .filter((v): v is any => v !== null && v.distance <= 5)
      .sort((a, b) => a.distance - b.distance);

    // Assign non-specialized tasks to top 10 matches
    const topGeneral = nearbyGeneralLabor.slice(0, 10);

    // Define general labor task descriptions based on incident type
    const generalTaskTitles = [
      'Relief Goods Distribution',
      'Evacuation Tent Setup',
      'Crowd Control & Guidance',
      'Basic Sanitation & Clean-up',
      'Runner/Messenger Duties',
    ];

    for (let i = 0; i < topGeneral.length; i++) {
      const vol = topGeneral[i];
      const taskTitle = generalTaskTitles[i % generalTaskTitles.length];

      const { data: task } = await supabaseAdmin
        .from('tasks')
        .insert({
          incident_id: incidentId,
          title: taskTitle,
          description: `General labor deployment for ${incident.title} at ${incident.address || 'incident location'}`,
          task_type: 'general_labor',
          assigned_to: vol.id,
          status: 'pending',
          latitude: incidentLat,
          longitude: incidentLng,
          address: incident.address,
        })
        .select('id')
        .single();

      result.assignedGeneralLabor.push({
        userId: vol.id,
        fullName: vol.full_name,
        role: 'volunteer_general',
        distanceKm: Math.round(vol.distance * 100) / 100,
        taskId: task?.id,
      });

      if (task) result.createdTasks.push(task.id);
    }
  }

  // ============================================
  // STEP 6: Logistics Trigger
  // ============================================

  if (classification.requiresRelief) {
    result.logisticsTriggered = true;

    // Flag available equipment for mobilization
    const equipmentItems = ['Aluminum Rescue Boat', '4x4 Rescue Truck', 'Mobile Command Unit', 'Portable Generator', 'Hydraulic Spreader'];

    const { data: availableInventory } = await supabaseAdmin
      .from('inventory')
      .select('*')
      .is('incident_id', null)
      .gt('quantity', 0)
      .limit(10);

    if (availableInventory && availableInventory.length > 0) {
      // Auto-assign equipment to this incident
      const itemIds = availableInventory.map((item) => item.id);

      await supabaseAdmin
        .from('inventory')
        .update({ incident_id: incidentId })
        .in('id', itemIds);

      result.logisticsDetails = `${availableInventory.length} MDRRMO equipment assets flagged for mobilization to incident zone.`;
    } else {
      result.logisticsDetails = 'No available equipment for automatic mobilization. Manual allocation required.';
    }
  }

  // Update incident status to in_progress
  await supabaseAdmin
    .from('incidents')
    .update({ status: 'in_progress' })
    .eq('id', incidentId);

  return result;
}

// ============================================
// Route Builder (Mapbox Directions)
// ============================================

export interface RouteInfo {
  duration: number; // seconds
  distance: number; // meters
  geometry: unknown;
}

/**
 * Get route from volunteer/unit location to incident location
 * using Project OSRM (Open Source Routing Machine) - Free/No Token Required.
 */
export async function getRoute(
  originLat: number, originLng: number,
  destLat: number, destLng: number
): Promise<RouteInfo | null> {
  try {
    // Project OSRM public API
    const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;

    const response = await fetch(url);
    const data: any = await response.json();

    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      return {
        duration: route.duration,
        distance: route.distance,
        geometry: route.geometry,
      };
    }

    return null;
  } catch (err) {
    console.error('OSRM routing error:', err);
    return null;
  }
}

/**
 * Check if a route passes near any blocked routes and get alternative
 * if necessary. Uses OSRM alternatives.
 */
export async function getRouteWithBlockedAvoidance(
  originLat: number, originLng: number,
  destLat: number, destLng: number
): Promise<RouteInfo | null> {
  // Get active blocked routes
  const { data: blockedRoutes } = await supabaseAdmin
    .from('blocked_routes')
    .select('latitude, longitude')
    .eq('active', true);

  // If no blocked routes, return direct route
  if (!blockedRoutes || blockedRoutes.length === 0) {
    return getRoute(originLat, originLng, destLat, destLng);
  }

  // Request route with alternatives from OSRM
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson&alternatives=true`;

    const response = await fetch(url);
    const data: any = await response.json();

    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      // Find a route that doesn't pass near any blocked points
      for (const route of data.routes) {
        const routePassesBlocked = blockedRoutes.some((blocked) => {
          const distToOrigin = haversineDistance(originLat, originLng, blocked.latitude, blocked.longitude);
          const distToDest = haversineDistance(destLat, destLng, blocked.latitude, blocked.longitude);
          const directDist = haversineDistance(originLat, originLng, destLat, destLng);

          // If the blocked point is close to the direct path
          return (distToOrigin + distToDest) < (directDist * 1.3) && 
                 Math.min(distToOrigin, distToDest) < 0.5; // within 500m
        });

        if (!routePassesBlocked) {
          return {
            duration: route.duration,
            distance: route.distance,
            geometry: route.geometry,
          };
        }
      }
      
      // If all routes pass through blocked areas, return the first one as fallback
      return {
        duration: data.routes[0].duration,
        distance: data.routes[0].distance,
        geometry: data.routes[0].geometry,
      };
    }
  } catch (err) {
    console.error('OSRM Alternative route error:', err);
  }

  return getRoute(originLat, originLng, destLat, destLng);
}
