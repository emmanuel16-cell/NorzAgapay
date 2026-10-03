import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { io } from '../server';
import {
  ARRIVAL_RADIUS_METERS,
  distanceMeters,
  validateArrivalFix,
  validateRecentGpsFix,
} from '../services/arrivalValidation';

const router = Router();

async function updateLinkedIncidentReport(
  incidentId: string,
  patch: Record<string, unknown>,
  onlyIfMissing?: 'accepted_at' | 'arrived_at' | 'resolved_at',
): Promise<void> {
  const result = onlyIfMissing
    ? await supabaseAdmin.from('incident_reports').update(patch)
      .eq('dispatch_incident_id', incidentId).is(onlyIfMissing, null).select('*')
    : await supabaseAdmin.from('incident_reports').update(patch)
      .eq('dispatch_incident_id', incidentId).select('*');
  if (result.error) throw result.error;
  for (const report of result.data || []) {
    io.to('dashboard_staff').emit('incident_report:updated', report);
    if (report.barangay_id) {
      io.to(`barangay:${report.barangay_id}`).emit('barangay:report_updated', report);
    }
  }
}

// ============================================
// GET /api/tasks — list tasks (filtered by role)
// ============================================

router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, incident_id, assigned_to } = req.query;
    const user = req.user!;

    let query = supabaseAdmin
      .from('tasks')
      .select('*, incident:incidents(*), assigned_user:users!assigned_to(full_name, role, phone), responders:task_volunteers(responder_id:volunteer_id, status, responder:users!volunteer_id(full_name))')
      .order('created_at', { ascending: false });

    const canManageTasks = ['master_admin', 'dispatcher'].includes(user.role);
    const canViewTasks = canManageTasks || ['logistics', 'responder'].includes(user.role);
    if (!canViewTasks) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    if (user.role === 'responder') {
      query = query.in('task_type', ['general_labor', 'specialist']);
    }

    if (status) query = query.eq('status', status as string);
    if (incident_id) query = query.eq('incident_id', incident_id as string);
    if (assigned_to && canManageTasks) {
      query = query.eq('assigned_to', assigned_to as string);
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: 'Failed to fetch tasks.' });
      return;
    }

    res.json({ tasks: data });
  } catch (err) {
    console.error('Fetch tasks error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// GET /api/tasks/:id — get task detail
// ============================================

router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .select('*, incident:incidents(*), assigned_user:users!assigned_to(full_name, role, phone)')
      .eq('id', req.params.id)
      .single();

    if (error || !task) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    // Only dashboard task managers and responders can view task details.
    const user = req.user!;
    if (!['master_admin', 'dispatcher', 'responder'].includes(user.role)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    res.json({ task });
  } catch (err) {
    console.error('Fetch task detail error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/tasks — create task (dispatcher/master admin)
// ============================================

const createTaskSchema = z.object({
  incident_id: z.string().uuid(),
  title: z.string().min(3),
  description: z.string().optional(),
  task_type: z.enum(['specialist', 'general_labor']),
  required_skill: z.string().optional(),
  assigned_to: z.string().uuid().optional(),
});

router.post(
  '/',
  authenticate,
  authorize('dispatcher'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsed = createTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const { data: task, error } = await supabaseAdmin
        .from('tasks')
        .insert({
          ...parsed.data,
          status: 'pending',
        })
        .select()
        .single();

      if (error) {
        console.error('Create task error:', error);
        res.status(500).json({ error: 'Failed to create task.' });
        return;
      }

      res.status(201).json({ message: 'Task created.', task });
    } catch (err) {
      console.error('Create task error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// PATCH /api/tasks/:id/status — update task status through arrival, return, and completion
// ============================================

const updateTaskStatusSchema = z.object({
  status: z.enum(['accepted', 'in_progress', 'returning', 'completed', 'cancelled']),
  proof_photo_url: z.string().url().nullable().optional(),
  arrival_method: z.enum(['gps', 'manual']).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy_m: z.number().min(0).optional(),
  fix_at: z.string().optional(),
});

router.patch('/:id/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = updateTaskStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error('Task status validation failed:', parsed.error.format());
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { status, proof_photo_url, arrival_method, latitude, longitude, accuracy_m, fix_at } = parsed.data;
    if ((latitude === undefined) !== (longitude === undefined)) {
      res.status(400).json({ error: 'Send both GPS coordinates or neither.' });
      return;
    }

    // Fetch task details with existing responders
    const { data: existingTask, error: fetchError } = await supabaseAdmin
      .from('tasks')
      .select('*, incident:incidents(latitude, longitude), responders:task_volunteers(responder_id:volunteer_id, status)')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existingTask) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    const user = req.user!;

    let acceptedResponderName: string | null = null;
    if (status === 'accepted' && user.role === 'responder' && !existingTask.accepted_at) {
      const { data: responder, error: responderError } = await supabaseAdmin
        .from('users')
        .select('full_name')
        .eq('id', user.userId)
        .maybeSingle();
      if (responderError) throw responderError;
      acceptedResponderName = responder?.full_name || null;
    }

    if (!['master_admin', 'dispatcher', 'responder'].includes(user.role)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const stageTime = new Date();
    let arrivalAt = stageTime;
    let arrivalDistanceM: number | null = null;
    const effectiveArrivalMethod = arrival_method || 'manual';
    const incidentLatitude = existingTask.latitude ?? existingTask.incident?.latitude;
    const incidentLongitude = existingTask.longitude ?? existingTask.incident?.longitude;
    if (status === 'in_progress' && user.role === 'responder' && existingTask.status !== 'accepted' && existingTask.status !== 'in_progress') {
      res.status(409).json({ error: 'Accept the dispatch before marking arrival.' });
      return;
    }
    if (status === 'in_progress' && !existingTask.arrived_at && effectiveArrivalMethod === 'gps') {
      if (latitude === undefined || longitude === undefined || accuracy_m === undefined || !fix_at || incidentLatitude == null || incidentLongitude == null) {
        res.status(400).json({ error: 'GPS arrival requires incident and responder coordinates, accuracy, and fix time.' });
        return;
      }
      const parsedFixAt = new Date(fix_at);
      if (Number.isNaN(parsedFixAt.getTime())) {
        res.status(400).json({ error: 'GPS fix time is invalid.' });
        return;
      }
      arrivalAt = new Date(Math.min(parsedFixAt.getTime(), stageTime.getTime()));
      const validation = validateArrivalFix(
        Number(incidentLatitude),
        Number(incidentLongitude),
        { latitude, longitude, accuracyM: accuracy_m, fixAt: parsedFixAt },
        stageTime,
      );
      if (!validation.valid) {
        res.status(422).json({ error: validation.error, distance_m: Math.round(validation.distanceM), arrival_radius_m: ARRIVAL_RADIUS_METERS });
        return;
      }
      arrivalDistanceM = validation.distanceM;
    } else if (status === 'in_progress' && !existingTask.arrived_at && latitude !== undefined && longitude !== undefined && incidentLatitude != null && incidentLongitude != null) {
      const validation = validateArrivalFix(
        Number(incidentLatitude),
        Number(incidentLongitude),
        { latitude, longitude, accuracyM: accuracy_m ?? 0, fixAt: stageTime },
        stageTime,
      );
      arrivalDistanceM = validation.distanceM;
    }

    const arrivalUpdate = status === 'in_progress' && !existingTask.arrived_at ? {
      arrived_at: arrivalAt.toISOString(),
      arrival_recorded_at: stageTime.toISOString(),
      arrival_method: effectiveArrivalMethod,
      arrival_latitude: latitude ?? null,
      arrival_longitude: longitude ?? null,
      arrival_accuracy_m: accuracy_m ?? null,
      arrival_distance_m: arrivalDistanceM === null ? null : Math.round(arrivalDistanceM * 10) / 10,
    } : {};
    const acceptedAt = status === 'accepted' && !existingTask.accepted_at ? stageTime.toISOString() : existingTask.accepted_at;
    const acceptanceTravelUpdate: Record<string, unknown> = {};
    if (status === 'accepted' && user.role === 'responder' && !existingTask.accepted_at &&
        latitude !== undefined && longitude !== undefined && accuracy_m !== undefined && fix_at &&
        incidentLatitude != null && incidentLongitude != null) {
      const fixAt = new Date(fix_at);
      const fix = { latitude, longitude, accuracyM: accuracy_m, fixAt };
      const validFix = validateRecentGpsFix(fix, stageTime);
      if (validFix.valid) {
        acceptanceTravelUpdate.travel_distance_m = Math.round(
          distanceMeters(Number(incidentLatitude), Number(incidentLongitude), latitude, longitude) * 10,
        ) / 10;
        acceptanceTravelUpdate.travel_distance_accuracy_m = Math.round(accuracy_m * 10) / 10;
        acceptanceTravelUpdate.travel_distance_fix_at = new Date(Math.min(fixAt.getTime(), stageTime.getTime())).toISOString();
      }
    }

    // If completing, require proof photo (only for production)
    if (status === 'completed' && !proof_photo_url && process.env.NODE_ENV === 'production') {
      res.status(400).json({ error: 'Proof photo is required to complete a task.' });
      return;
    }

    // Responders use the junction table so multiple responders may join a task.
    if (user.role === 'responder') {
      if (['accepted', 'in_progress'].includes(status)) {
        const { error: joinError } = await supabaseAdmin
          .from('task_volunteers')
          .upsert({ 
            task_id: req.params.id, 
            volunteer_id: user.userId,
            status: status === 'completed' ? 'completed' : 'joined'
          }, { onConflict: 'task_id,volunteer_id' });

        if (joinError) {
          console.error('Join Task Error:', joinError);
          res.status(500).json({ error: 'Failed to join task.' });
          return;
        }

        // Mark user as occupied
        await supabaseAdmin.from('users').update({ status: 'occupied' }).eq('id', user.userId);
        
        // Update main task status if it was pending
        let mainTaskUpdate: any = {};
        if (existingTask.status === 'pending') {
          mainTaskUpdate.status = status;
        } else if (existingTask.status === 'accepted' && status === 'in_progress') {
          mainTaskUpdate.status = 'in_progress';
        }

        if (status === 'accepted' && !existingTask.accepted_at) {
          mainTaskUpdate.accepted_at = acceptedAt;
          Object.assign(mainTaskUpdate, acceptanceTravelUpdate);
        }
        if (status === 'in_progress' && !existingTask.arrived_at) Object.assign(mainTaskUpdate, arrivalUpdate);

        if (Object.keys(mainTaskUpdate).length > 0) {
          const { error: taskUpdateError } = await supabaseAdmin
            .from('tasks').update(mainTaskUpdate).eq('id', req.params.id);
          if (taskUpdateError) throw taskUpdateError;
        }

        if (status === 'accepted') {
          const linkedTravelUpdate = existingTask.travel_distance_m != null ? {
            travel_distance_m: existingTask.travel_distance_m,
            travel_distance_accuracy_m: existingTask.travel_distance_accuracy_m ?? null,
            travel_distance_fix_at: existingTask.travel_distance_fix_at ?? null,
          } : acceptanceTravelUpdate;
          await updateLinkedIncidentReport(existingTask.incident_id, {
            status: 'responding',
            accepted_at: acceptedAt,
            ...linkedTravelUpdate,
          }, 'accepted_at');
          if (acceptedResponderName) {
            await updateLinkedIncidentReport(existingTask.incident_id, {
              mdrrmo_responder_name: acceptedResponderName,
            });
          }
        } else if (status === 'in_progress') {
          if (existingTask.accepted_at) {
            await updateLinkedIncidentReport(existingTask.incident_id, {
              accepted_at: existingTask.accepted_at,
            }, 'accepted_at');
          }
          const linkedArrivalUpdate = existingTask.arrived_at ? {
            arrived_at: existingTask.arrived_at,
            arrival_recorded_at: existingTask.arrival_recorded_at || existingTask.arrived_at,
            arrival_method: existingTask.arrival_method || 'manual',
            arrival_latitude: existingTask.arrival_latitude ?? null,
            arrival_longitude: existingTask.arrival_longitude ?? null,
            arrival_accuracy_m: existingTask.arrival_accuracy_m ?? null,
            arrival_distance_m: existingTask.arrival_distance_m ?? null,
          } : arrivalUpdate;
          await updateLinkedIncidentReport(existingTask.incident_id, linkedArrivalUpdate, 'arrived_at');
        }
        
        // Broadcast update
        io.to('dashboard_staff').emit('task:statusChanged', { taskId: req.params.id, status, userId: user.userId });
        
        // Re-fetch updated task to return full state
        const { data: updatedTask } = await supabaseAdmin
          .from('tasks')
          .select('*, responders:task_volunteers(responder_id:volunteer_id, status)')
          .eq('id', req.params.id)
          .single();

        res.json({ 
          message: `Task successfully updated to ${status}.`,
          task: updatedTask || { ...existingTask, status: mainTaskUpdate.status || existingTask.status }
        });
        return;
      } else if (status === 'completed') {
        if (!existingTask.arrived_at) {
          res.status(409).json({ error: 'Record arrival before completing the response.' });
          return;
        }
        const { error: completeError } = await supabaseAdmin
          .from('task_volunteers')
          .update({ status: 'completed' })
          .eq('task_id', req.params.id)
          .eq('volunteer_id', user.userId);

        if (completeError) {
          console.error('Complete Task Error:', completeError);
          res.status(500).json({ error: 'Failed to complete task.' });
          return;
        }

        // Mark user as active again
        await supabaseAdmin.from('users').update({ status: 'active' }).eq('id', user.userId);
        
        // Check whether all assigned responders have completed.
        // For simplicity, we mark the main task as completed too
        await supabaseAdmin.from('tasks').update({ 
          status: 'completed',
          completed_at: stageTime.toISOString(),
          proof_photo_url: proof_photo_url || null
        }).eq('id', req.params.id);
        await updateLinkedIncidentReport(existingTask.incident_id, {
          status: 'resolved',
          mdrrmo_response_status: 'resolved',
          resolved_at: stageTime.toISOString(),
        }, 'resolved_at');

        // Broadcast update
          io.to('dashboard_staff').emit('task:statusChanged', { taskId: req.params.id, status: 'completed', userId: user.userId });
        
        res.json({ message: 'Task marked as completed.' });
        return;
      }
    }

    // Dispatcher or master admin direct status update for the whole task
    const updateData: Record<string, unknown> = { status };
    if (status === 'accepted' && acceptedAt) {
      updateData.accepted_at = acceptedAt;
      Object.assign(updateData, acceptanceTravelUpdate);
    }
    if (status === 'in_progress' && !existingTask.arrived_at) Object.assign(updateData, arrivalUpdate);
    if (status === 'returning') updateData.returning_at = stageTime.toISOString();
    if (proof_photo_url) updateData.proof_photo_url = proof_photo_url;
    if (status === 'completed') {
      if (!existingTask.arrived_at) {
        res.status(409).json({ error: 'Record arrival before completing the response.' });
        return;
      }
      updateData.completed_at = stageTime.toISOString();
    }

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to update task status.' });
      return;
    }

    if (status === 'accepted') {
      const linkedTravelUpdate = existingTask.travel_distance_m != null ? {
        travel_distance_m: existingTask.travel_distance_m,
        travel_distance_accuracy_m: existingTask.travel_distance_accuracy_m ?? null,
        travel_distance_fix_at: existingTask.travel_distance_fix_at ?? null,
      } : acceptanceTravelUpdate;
      await updateLinkedIncidentReport(existingTask.incident_id, {
        status: 'responding',
        accepted_at: acceptedAt,
        ...linkedTravelUpdate,
      }, 'accepted_at');
      if (acceptedResponderName) {
        await updateLinkedIncidentReport(existingTask.incident_id, {
          mdrrmo_responder_name: acceptedResponderName,
        });
      }
    } else if (status === 'in_progress') {
      if (existingTask.accepted_at) {
        await updateLinkedIncidentReport(existingTask.incident_id, {
          accepted_at: existingTask.accepted_at,
        }, 'accepted_at');
      }
      const linkedArrivalUpdate = existingTask.arrived_at ? {
        arrived_at: existingTask.arrived_at,
        arrival_recorded_at: existingTask.arrival_recorded_at || existingTask.arrived_at,
        arrival_method: existingTask.arrival_method || 'manual',
        arrival_latitude: existingTask.arrival_latitude ?? null,
        arrival_longitude: existingTask.arrival_longitude ?? null,
        arrival_accuracy_m: existingTask.arrival_accuracy_m ?? null,
        arrival_distance_m: existingTask.arrival_distance_m ?? null,
      } : arrivalUpdate;
      await updateLinkedIncidentReport(existingTask.incident_id, linkedArrivalUpdate, 'arrived_at');
    } else if (status === 'completed') {
      await updateLinkedIncidentReport(existingTask.incident_id, {
        status: 'resolved',
        mdrrmo_response_status: 'resolved',
        resolved_at: stageTime.toISOString(),
      }, 'resolved_at');
    }

    // Broadcast update
    io.to('dashboard_staff').emit('task:statusChanged', { taskId: req.params.id, status, userId: user.userId });

    res.json({ message: `Task status updated to ${status}.`, task });
  } catch (err) {
    console.error('Update task status error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// PATCH /api/tasks/:id/reassign — reassign task (dispatcher/master admin)
// ============================================

router.patch(
  '/:id/reassign',
  authenticate,
  authorize('dispatcher'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { assigned_to } = req.body;
      if (!assigned_to) {
        res.status(400).json({ error: 'assigned_to is required.' });
        return;
      }

      const { data: task, error } = await supabaseAdmin
        .from('tasks')
        .update({ assigned_to, status: 'pending' })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) {
        res.status(500).json({ error: 'Failed to reassign task.' });
        return;
      }

      res.json({ message: 'Task reassigned.', task });
    } catch (err) {
      console.error('Reassign task error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// POST /api/tasks/:id/members — Team Leader adds members on the move
// ============================================

router.post('/:id/members', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { member_ids } = req.body;

    if (!member_ids || !Array.isArray(member_ids) || member_ids.length === 0) {
      res.status(400).json({ error: 'member_ids array is required' });
      return;
    }

    const { data: task, error: fetchError } = await supabaseAdmin
      .from('tasks')
      .select('*, incident:incidents(*)')
      .eq('id', id)
      .single();

    if (fetchError || !task) {
      res.status(404).json({ error: 'Task / dispatch not found.' });
      return;
    }

    // Add each responder into task_volunteers
    for (const memberId of member_ids) {
      let resolvedUserId = memberId;

      // If officer ID is passed, resolve to user ID
      const { data: off } = await supabaseAdmin
        .from('officers')
        .select('email')
        .eq('id', memberId)
        .maybeSingle();

      if (off && off.email) {
        const { data: matchedUser } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('email', off.email)
          .maybeSingle();
        if (matchedUser) {
          resolvedUserId = matchedUser.id;
        }
      }

      await supabaseAdmin
        .from('task_volunteers')
        .upsert({
          task_id: id,
          volunteer_id: resolvedUserId,
          status: 'joined',
        }, { onConflict: 'task_id,volunteer_id' });

      // Mark user status as occupied
      await supabaseAdmin
        .from('users')
        .update({ status: 'occupied' })
        .eq('id', resolvedUserId);
    }

    // Emit real-time notification
    io.to('dashboard_staff').emit('task:membersUpdated', { taskId: id, memberIds: member_ids });

    // Fetch updated task with all assigned responders
    const { data: updatedTask } = await supabaseAdmin
      .from('tasks')
      .select('*, incident:incidents(*), responders:task_volunteers(responder_id:volunteer_id, status)')
      .eq('id', id)
      .single();

    res.json({
      message: 'Members added to dispatch team successfully.',
      task: updatedTask,
    });
  } catch (err: any) {
    console.error('Add members on the move error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
