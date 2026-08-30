import { Router, Response } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { supabaseAdmin } from '../config/supabase';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

// ============================================
// GET /api/inventory — list inventory
// ============================================

router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { location, incident_id } = req.query;

    let query = supabaseAdmin
      .from('inventory')
      .select('*, incident:incidents(title, status)')
      .order('created_at', { ascending: false });

    if (location) query = query.eq('location', location as string);
    if (incident_id) query = query.eq('incident_id', incident_id as string);

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: 'Failed to fetch inventory.' });
      return;
    }

    res.json({ inventory: data });
  } catch (err) {
    console.error('Fetch inventory error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/inventory — add donation
// ============================================

const addInventorySchema = z.object({
  item_name: z.string().min(1),
  quantity: z.number().int().positive(),
  unit: z.string().min(1),
  location: z.string().optional(),
  donated_by: z.string().optional(),
  incident_id: z.string().uuid().optional(),
});

router.post(
  '/',
  authenticate,
  authorize('admin', 'commander'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsed = addInventorySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const { data: item, error } = await supabaseAdmin
        .from('inventory')
        .insert(parsed.data)
        .select()
        .single();

      if (error) {
        res.status(500).json({ error: 'Failed to add inventory item.' });
        return;
      }

      res.status(201).json({ message: 'Inventory item added.', item });
    } catch (err) {
      console.error('Add inventory error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// PATCH /api/inventory/:id — update inventory
// ============================================

router.patch(
  '/:id',
  authenticate,
  authorize('admin', 'commander'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const updateSchema = z.object({
        quantity: z.number().int().optional(),
        location: z.string().optional(),
        incident_id: z.string().uuid().nullable().optional(),
      });

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      const { data: item, error } = await supabaseAdmin
        .from('inventory')
        .update(parsed.data)
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) {
        res.status(500).json({ error: 'Failed to update inventory.' });
        return;
      }

      res.json({ message: 'Inventory updated.', item });
    } catch (err) {
      console.error('Update inventory error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// GET /api/inventory/shipments — list shipments
// ============================================

router.get('/shipments', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.query;

    let query = supabaseAdmin
      .from('relief_shipments')
      .select('*, inventory:inventory(item_name, unit), driver:users!driver_user_id(full_name, phone, latitude, longitude)')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status as string);

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ error: 'Failed to fetch shipments.' });
      return;
    }

    res.json({ shipments: data });
  } catch (err) {
    console.error('Fetch shipments error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/inventory/shipments — create shipment with QR code
// ============================================

const createShipmentSchema = z.object({
  inventory_id: z.string().uuid(),
  quantity_sent: z.number().int().positive(),
  driver_user_id: z.string().uuid().optional(),
  origin: z.string().min(1),
  destination: z.string().min(1),
});

router.post(
  '/shipments',
  authenticate,
  authorize('admin', 'commander'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsed = createShipmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
        return;
      }

      // Generate unique QR code content
      const qrContent = `NORZAGAPAY-SHIPMENT-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const { data: shipment, error } = await supabaseAdmin
        .from('relief_shipments')
        .insert({
          ...parsed.data,
          qr_code: qrContent,
          status: 'loading',
        })
        .select()
        .single();

      if (error) {
        console.error('Create shipment error:', error);
        res.status(500).json({ error: 'Failed to create shipment.' });
        return;
      }

      // Generate QR code as data URL
      const qrDataUrl = await QRCode.toDataURL(qrContent, {
        width: 300,
        margin: 2,
        color: { dark: '#1B4F72', light: '#FFFFFF' },
      });

      // Deduct from inventory
      const { data: inventoryItem } = await supabaseAdmin
        .from('inventory')
        .select('quantity')
        .eq('id', parsed.data.inventory_id)
        .single();

      if (inventoryItem) {
        await supabaseAdmin
          .from('inventory')
          .update({ quantity: Math.max(0, inventoryItem.quantity - parsed.data.quantity_sent) })
          .eq('id', parsed.data.inventory_id);
      }

      res.status(201).json({
        message: 'Shipment created with QR code.',
        shipment,
        qr_code_image: qrDataUrl,
      });
    } catch (err) {
      console.error('Create shipment error:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ============================================
// PATCH /api/inventory/shipments/:id/scan — QR code scan (update shipment status)
// ============================================

router.patch('/shipments/:id/scan', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { qr_code } = req.body;

    const { data: shipment, error: fetchError } = await supabaseAdmin
      .from('relief_shipments')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !shipment) {
      res.status(404).json({ error: 'Shipment not found.' });
      return;
    }

    // Verify QR code matches
    if (shipment.qr_code !== qr_code) {
      res.status(400).json({ error: 'QR code does not match shipment.' });
      return;
    }

    // Progress status: loading → in_transit → delivered
    let newStatus: string;
    const updateData: Record<string, unknown> = {};

    if (shipment.status === 'loading') {
      newStatus = 'in_transit';
    } else if (shipment.status === 'in_transit') {
      newStatus = 'delivered';
      updateData.delivered_at = new Date().toISOString();
    } else {
      res.status(400).json({ error: 'Shipment already delivered.' });
      return;
    }

    updateData.status = newStatus;

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('relief_shipments')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();

    if (updateError) {
      res.status(500).json({ error: 'Failed to update shipment.' });
      return;
    }

    res.json({ message: `Shipment status updated to ${newStatus}.`, shipment: updated });
  } catch (err) {
    console.error('Scan shipment error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
