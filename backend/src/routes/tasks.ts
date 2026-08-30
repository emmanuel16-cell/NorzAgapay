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
      .select('*, incident:incidents(*), assigned_user:users!assigned_to(full_name, role, phone), volunteers:task_volunteers(volunteer_id)')
      .order('created_at', { ascending: false });

    // Non-admin users can see all tasks matching their role type
    if (!['admin', 'commander'].includes(user.role)) {
      const allowedTypes = ['general_labor'];
      if (user.role === 'volunteer_specialist') {
        allowedTypes.push('specialist');
      }
      
      query = query.in('task_type', allowedTypes);
    }

    if (status) query = query.eq('status', status as string);
    if (incident_id) query = query.eq('incident_id', incident_id as string);
    if (assigned_to && ['admin', 'commander'].includes(user.role)) {
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

    // Non-admin users can only view tasks of their allowed types
    const user = req.user!;
    if (!['admin', 'commander'].includes(user.role)) {
      const allowedTypes = ['general_labor'];
      if (user.role === 'volunteer_specialist') {
        allowedTypes.push('specialist');
      }
      if (!allowedTypes.includes(task.task_type)) {
        res.status(403).json({ error: 'Access denied.' });
        return;
      }
    }

    res.json({ task });
  } catch (err) {
    console.error('Fetch task detail error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/tasks — create task (admin/commander)
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
  authorize('admin', 'commander'),
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
// PATCH /api/tasks/:id/status — update task status (accept, arrive, complete)
// ============================================

const updateTaskStatusSchema = z.object({
  status: z.enum(['accepted', 'in_progress', 'completed', 'cancelled']),
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

    // Fetch task details with existing volunteers
    const { data: existingTask, error: fetchError } = await supabaseAdmin
      .from('tasks')
      .select('*, volunteers:task_volunteers(volunteer_id, status)')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existingTask) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    const user = req.user!;

    // DEV MODE: Allow any volunteer to accept any task for testing
    // Enforce role-based task acceptance rules (DISABLED FOR DEV)
    /*
    if (status === 'accepted') {
      if (user.role === 'volunteer_general' && existingTask.task_type !== 'general_labor') {
        res.status(403).json({ error: 'General volunteers can only accept general labor tasks.' });
        return;
      }
      if (user.role === 'volunteer_specialist' && existingTask.task_type !== 'specialist') {
        res.status(403).json({ error: 'Specialist volunteers can only accept specialized rescue tasks.' });
        return;
      }
    }
    */

    // NEW: Check if volunteer already has an active task (DISABLED FOR DEV)
    /*
    if (!['admin', 'commander'].includes(user.role) && ['accepted', 'in_progress'].includes(status)) {
      const { data: otherActiveTasks } = await supabaseAdmin
        .from('task_volunteers')
        .select('task_id')
        .eq('volunteer_id', user.userId)
        .eq('status', 'joined')
        .neq('task_id', req.params.id)
        .limit(1);

      if (otherActiveTasks && otherActiveTasks.length > 0 && status === 'accepted') {
        res.status(400).json({ 
          error: 'You already have an active task. Please complete your current task before accepting a new one.' 
        });
        return;
      }
    }
    */

    // If completing, require proof photo (only for production)
    if (status === 'completed' && !proof_photo_url && process.env.NODE_ENV === 'production') {
      res.status(400).json({ error: 'Proof photo is required to complete a task.' });
      return;
    }

    // Volunteers always use the junction table
    if (!['admin', 'commander'].includes(user.role)) {
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

        if (Object.keys(mainTaskUpdate).length > 0) {
          await supabaseAdmin.from('tasks').update(mainTaskUpdate).eq('id', req.params.id);
        }
        
        // Broadcast update
        io.to('commanders').emit('task:statusChanged', { taskId: req.params.id, status, userId: user.userId });
        
        // Re-fetch updated task to return full state
        const { data: updatedTask } = await supabaseAdmin
          .from('tasks')
          .select('*, volunteers:task_volunteers(volunteer_id, status)')
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
        
        // Check if ALL volunteers have completed (optional, for now just update task status if it's the only one)
        // For simplicity, we mark the main task as completed too
        await supabaseAdmin.from('tasks').update({ 
          status: 'completed',
          completed_at: new Date().toISOString(),
          proof_photo_url: proof_photo_url || null
        }).eq('id', req.params.id);

        // Broadcast update
        io.to('commanders').emit('task:statusChanged', { taskId: req.params.id, status: 'completed', userId: user.userId });
        
        res.json({ message: 'Task marked as completed.' });
        return;
      }
    }

    // Admin/Commander direct status update for the whole task
    const updateData: Record<string, unknown> = { status };
    if (proof_photo_url) updateData.proof_photo_url = proof_photo_url;
    if (status === 'completed') updateData.completed_at = new Date().toISOString();

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
    io.to('commanders').emit('task:statusChanged', { taskId: req.params.id, status, userId: user.userId });

    res.json({ message: `Task status updated to ${status}.`, task });
  } catch (err) {
    console.error('Update task status error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// PATCH /api/tasks/:id/reassign — reassign task (admin/commander)
// ============================================

router.patch(
  '/:id/reassign',
  authenticate,
  authorize('admin', 'commander'),
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

export default router;
