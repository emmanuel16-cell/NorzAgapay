import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { io } from '../server';

const router = Router();

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
});

router.patch('/:id/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = updateTaskStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error('Task status validation failed:', parsed.error.format());
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { status, proof_photo_url } = parsed.data;

    // Fetch task details with existing responders
    const { data: existingTask, error: fetchError } = await supabaseAdmin
      .from('tasks')
      .select('*, responders:task_volunteers(responder_id:volunteer_id, status)')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existingTask) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    const user = req.user!;

    if (!['master_admin', 'dispatcher', 'responder'].includes(user.role)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
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

        const stageTime = new Date().toISOString();
        if (status === 'accepted' && !existingTask.accepted_at) mainTaskUpdate.accepted_at = stageTime;
        if (status === 'in_progress' && !existingTask.arrived_at) mainTaskUpdate.arrived_at = stageTime;

        if (Object.keys(mainTaskUpdate).length > 0) {
          await supabaseAdmin.from('tasks').update(mainTaskUpdate).eq('id', req.params.id);
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
          completed_at: new Date().toISOString(),
          proof_photo_url: proof_photo_url || null
        }).eq('id', req.params.id);

        // Broadcast update
          io.to('dashboard_staff').emit('task:statusChanged', { taskId: req.params.id, status: 'completed', userId: user.userId });
        
        res.json({ message: 'Task marked as completed.' });
        return;
      }
    }

    // Dispatcher or master admin direct status update for the whole task
    const updateData: Record<string, unknown> = { status };
    const stageTime = new Date().toISOString();
    if (status === 'accepted') updateData.accepted_at = stageTime;
    if (status === 'in_progress') updateData.arrived_at = stageTime;
    if (status === 'returning') updateData.returning_at = stageTime;
    if (proof_photo_url) updateData.proof_photo_url = proof_photo_url;
    if (status === 'completed') updateData.completed_at = stageTime;

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
