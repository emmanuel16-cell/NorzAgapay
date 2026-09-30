import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';
import { io } from '../server';

const router = Router();

// GET /api/responder-dispatch - list all responder dispatches
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('volunteer_dispatches')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ dispatches: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/responder-dispatch - create new responder dispatch
router.post('/', authenticate, authorize('dispatcher'), async (req: AuthRequest, res: Response) => {
  try {
    const { 
      team_name, 
      dispatch_date, 
      dispatch_time, 
      meetup_location, 
      meetup_latitude,
      meetup_longitude,
      destination, 
      mission_id, 
      responder_ids
    } = req.body;
    
    if (!team_name || !dispatch_date || !dispatch_time || !meetup_location || !destination) {
      res.status(400).json({ error: 'All dispatch details are required' });
      return;
    }

    // 1. Create the dispatch entry
    const { data: dispatch, error: dispatchError } = await supabaseAdmin
      .from('volunteer_dispatches')
      .insert([{ 
        team_name, 
        dispatch_date, 
        dispatch_time, 
        meetup_location, 
        meetup_latitude,
        meetup_longitude,
        destination, 
        mission_id: mission_id || null, 
        volunteer_ids: responder_ids || []
      }])
      .select()
      .single();

    if (dispatchError) throw dispatchError;

    // 2. Create tasks for each responder if any are selected
    if (responder_ids && responder_ids.length > 0) {
      let finalMissionId = mission_id;

      // If no mission_id, find or create a "General Dispatch" incident
      if (!finalMissionId) {
        const { data: generalIncident, error: findError } = await supabaseAdmin
          .from('incidents')
          .select('id')
          .eq('title', 'General Responder Dispatch')
          .limit(1)
          .maybeSingle();

        if (findError) {
          console.error('Error finding general incident:', findError);
        }

        if (generalIncident) {
          finalMissionId = generalIncident.id;
        } else {
          // Create a general incident
          const { data: newIncident, error: createError } = await supabaseAdmin
            .from('incidents')
            .insert({
              title: 'General Responder Dispatch',
              type: 'emergency',
              severity: 'moderate',
              latitude: 14.904246495288923, // MDRRMO Headquarters, Norzagaray
              longitude: 121.0430072345187,
              address: 'MDRRMO Headquarters, Norzagaray (General Dispatch)',
              status: 'open',
              reported_by: req.user?.userId || null
            })
            .select()
            .single();

          if (createError) {
            console.error('Error creating general incident:', createError);
          } else if (newIncident) {
            finalMissionId = newIncident.id;
          }
        }
      }

      if (finalMissionId) {
        const taskToCreate = {
          incident_id: finalMissionId,
          title: `Responder Dispatch: ${team_name}`,
          description: `You will be dispatched to ${destination}.\n\n📅 Date: ${dispatch_date}\n⏰ Time: ${dispatch_time}\n📍 Meet-up: ${meetup_location}`,
          task_type: 'general_labor',
          assigned_to: null,
          status: 'pending',
          latitude: meetup_latitude || null,
          longitude: meetup_longitude || null,
          address: meetup_location
        };

        const { error: taskError } = await supabaseAdmin
          .from('tasks')
          .insert([taskToCreate]);
        
        if (taskError) {
          console.error('Failed to create task for dispatch:', taskError);
        } else {
          console.log(`Successfully created open task for dispatch team ${team_name}`);
          // Notify via Socket
          responder_ids.forEach((vId: string) => {
            io.to(`user:${vId}`).emit('task:new');
          });
        }
      } else {
        console.error('Could not determine a mission_id for task creation');
      }
    }

    res.status(201).json({ dispatch });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/responder-dispatch/:id - delete dispatch
router.delete('/:id', authenticate, authorize('dispatcher'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('volunteer_dispatches')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
