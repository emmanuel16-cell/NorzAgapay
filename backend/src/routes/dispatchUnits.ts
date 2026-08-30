import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const DATA_FILE = path.join(process.cwd(), 'data', 'dispatch_units.json');

// Ensure data directory exists
const ensureDataFile = () => {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
  }
};

const getUnits = () => {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
};

const saveUnits = (units: any[]) => {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(units, null, 2));
};

// GET /api/dispatch-units - list all units
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  res.json({ units: getUnits() });
});

// POST /api/dispatch-units - create new unit
router.post('/', authenticate, authorize('admin', 'commander'), (req: AuthRequest, res: Response) => {
  const { name, type, personnel } = req.body;
  if (!name || !type) {
    res.status(400).json({ error: 'Name and type are required' });
    return;
  }
  const units = getUnits();
  const newUnit = {
    id: uuidv4(),
    name,
    type,
    personnel: personnel || [],
    status: 'available',
    created_at: new Date().toISOString()
  };
  units.push(newUnit);
  saveUnits(units);
  res.status(201).json(newUnit);
});

// DELETE /api/dispatch-units/:id - delete unit
router.delete('/:id', authenticate, authorize('admin', 'commander'), (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  let units = getUnits();
  const filtered = units.filter((u: any) => u.id !== id);
  if (units.length === filtered.length) {
    res.status(404).json({ error: 'Unit not found' });
    return;
  }
  saveUnits(filtered);
  res.status(204).send();
});

export default router;
