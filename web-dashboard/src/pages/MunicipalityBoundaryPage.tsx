import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Check, CircleHelp, LoaderCircle, MapPin, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { municipalityBoundaryAPI } from '../lib/api';
import { boundaryPolygons, type BoundaryGeometry, type MunicipalityBoundary } from '../lib/municipalityBoundary';
import { useMunicipalityBoundary } from '../context/MunicipalityBoundaryContext';
import MunicipalityBoundaryMapLayer from '../components/MunicipalityBoundaryMapLayer';
import { CARTO_ATTRIBUTION, CARTO_DARK_MAP_URL } from '../lib/mapConfig';

type Point = [number, number]; // latitude, longitude for Leaflet
type DraftPart = Point[];
const DEFAULT_CENTER: Point = [14.9133, 121.0436];

function geometryToParts(geometry: BoundaryGeometry | null): DraftPart[] {
  return boundaryPolygons(geometry).map((polygon) => {
    const ring = polygon[0] ?? [];
    const openRing = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
    return openRing.map(([longitude, latitude]) => [latitude, longitude]);
  });
}

function partsToGeometry(parts: DraftPart[]): BoundaryGeometry {
  const polygons = parts.map((part) => {
    const ring = part.map(([latitude, longitude]): [number, number] => [longitude, latitude]);
    if (ring.length > 0) ring.push([...ring[0]]);
    return [ring];
  });
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

function isValidParts(parts: DraftPart[]) {
  return parts.length > 0 && parts.every((part) => {
    const distinct = new Set(part.map(([lat, lng]) => `${lat.toFixed(7)},${lng.toFixed(7)}`));
    if (distinct.size < 3) return false;
    const [first, second] = part;
    return part.some(([lat, lng]) => Math.abs(
      (second[1] - first[1]) * (lat - first[0]) -
      (second[0] - first[0]) * (lng - first[1]),
    ) >= 1e-12);
  });
}

function createVertexIcon(index: number, selected: boolean) {
  return L.divIcon({
    className: 'boundary-vertex-icon',
    html: `<span class="boundary-vertex ${selected ? 'selected' : ''}">${index + 1}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function DraftMapEvents({ editing, onAdd }: { editing: boolean; onAdd: (point: Point) => void }) {
  useMapEvents({
    click(event) {
      if (editing) onAdd([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

function FitDraft({ parts, fitKey }: { parts: DraftPart[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    const points = parts.flat().map(([latitude, longitude]) => L.latLng(latitude, longitude));
    if (points.length > 0) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 12 });
    else map.setView(DEFAULT_CENTER, 11);
  // Fit only on boundary load/edit mode changes, not for each dragged point.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

function responseConfig(value: any): MunicipalityBoundary {
  return {
    geometry: value.geometry as BoundaryGeometry,
    enabled: value.enabled === true,
    revision: Number(value.revision ?? 0),
    updated_by: value.updated_by ?? null,
    updated_at: value.updated_at ?? null,
  };
}

export default function MunicipalityBoundaryPage() {
  const { boundary, loading, setBoundary } = useMunicipalityBoundary();
  const [parts, setParts] = useState<DraftPart[]>([]);
  const [activePart, setActivePart] = useState(0);
  const [selectedVertex, setSelectedVertex] = useState<{ part: number; index: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedGeometryLoaded, setSavedGeometryLoaded] = useState(false);
  const [editRevision, setEditRevision] = useState(0);
  const [history, setHistory] = useState<MunicipalityBoundary[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const response = await municipalityBoundaryAPI.history();
      setHistory((response.data || []).map(responseConfig));
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (!dirty && boundary.geometry) {
      setParts(geometryToParts(boundary.geometry));
      setSavedGeometryLoaded(true);
    }
  }, [boundary.geometry, boundary.revision, dirty]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const valid = isValidParts(parts);
  const fitKey = `${boundary.revision}-${editing}-${parts.length}-${savedGeometryLoaded}`;
  const draftGeometry = useMemo(() => valid ? partsToGeometry(parts) : null, [parts, valid]);

  const save = async (geometry: BoundaryGeometry, enabled: boolean, confirmMessage: string, expectedRevision = boundary.revision) => {
    if (!window.confirm(confirmMessage)) return false;
    setSaving(true);
    try {
      const response = await municipalityBoundaryAPI.save({
        geometry,
        enabled,
        expectedRevision,
      });
      const next = responseConfig(response.data);
      setBoundary(next);
      void loadHistory();
      setParts(geometryToParts(next.geometry));
      setDirty(false);
      setEditing(false);
      setSelectedVertex(null);
      toast.success(enabled ? 'Boundary saved and enabled across all app maps.' : 'Boundary saved and disabled across all app maps.');
      return true;
    } catch (error: any) {
      const message = error?.response?.data?.error;
      toast.error(typeof message === 'string' ? message : 'Could not save municipality boundary.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const changeEnabled = async (enabled: boolean) => {
    if (!boundary.geometry || !isValidParts(geometryToParts(boundary.geometry))) {
      toast.error('Create and save a boundary with at least three points first.');
      return;
    }
    await save(
      boundary.geometry,
      enabled,
      enabled
        ? 'Use this boundary across the web dashboard, mobile app, and resident app? Web dashboard maps will blur areas outside it, and location/report checks will use it.'
        : 'Disable the municipality boundary across all apps? Full maps will be visible and boundary-based restrictions will stop.',
    );
  };

  const addPoint = (point: Point) => {
    setParts((current) => {
      if (current.length === 0) {
        setActivePart(0);
        return [[point]];
      }
      return current.map((part, index) => index === activePart ? [...part, point] : part);
    });
    setSelectedVertex(null);
    setDirty(true);
  };

  const movePoint = (partIndex: number, pointIndex: number, point: Point) => {
    setParts((current) => current.map((part, currentPart) => currentPart !== partIndex
      ? part
      : part.map((existing, currentPoint) => currentPoint === pointIndex ? point : existing)));
    setDirty(true);
  };

  const addPart = () => {
    setParts((current) => [...current, []]);
    const nextPart = parts.length;
    setActivePart(nextPart);
    setSelectedVertex(null);
    setDirty(true);
  };

  const removeSelected = () => {
    if (!selectedVertex) return;
    const { part: partIndex, index: pointIndex } = selectedVertex;
    setParts((current) => current.map((part, currentPart) => currentPart === partIndex
      ? part.filter((_, index) => index !== pointIndex)
      : part));
    setSelectedVertex(null);
    setDirty(true);
  };

  const resetToSaved = () => {
    setParts(geometryToParts(boundary.geometry));
    setDirty(false);
    setSelectedVertex(null);
  };

  const saveDraft = async () => {
    if (!valid || !draftGeometry) {
      toast.error('Add at least three distinct points to every boundary part.');
      return;
    }
    await save(
      draftGeometry,
      boundary.enabled,
      `Save this ${parts.reduce((sum, part) => sum + part.length, 0)}-point municipality boundary${boundary.enabled ? ' and apply it across all apps' : ''}?`,
      editRevision,
    );
  };

  return <>
    <div className="page-header">
      <div>
        <h1 className="page-title">Municipality Boundary</h1>
        <p className="page-subtitle">Set the shared map boundary for the web dashboard, mobile app, and resident app.</p>
      </div>
    </div>
    <div className="page-content municipality-boundary-page">
      <section className="card municipality-boundary-controls">
        <div className="municipality-boundary-status">
          <div className={`boundary-status-pill ${boundary.enabled ? 'enabled' : 'disabled'}`}>
            <span className="boundary-status-dot" />
            {boundary.enabled ? 'Boundary in use' : 'Full map in use'}
          </div>
          <p>{boundary.enabled
            ? 'Web dashboard maps blur areas outside this boundary. Location and resident report checks use this shape across apps.'
            : 'No boundary restriction is active. All app maps show the full map.'}</p>
          {boundary.updated_at && <small>Last saved {new Date(boundary.updated_at).toLocaleString()}</small>}
        </div>
        <div className="municipality-boundary-actions">
          {!editing ? <>
            <button className="btn btn-outline" type="button" onClick={() => { setEditing(true); setDirty(false); setEditRevision(boundary.revision); }} disabled={loading || saving}>
              <MapPin size={16} /> Edit boundary
            </button>
            <button className={`btn ${boundary.enabled ? 'btn-outline' : 'btn-primary'}`} type="button" onClick={() => changeEnabled(!boundary.enabled)} disabled={saving || loading}>
              {saving ? <LoaderCircle className="boundary-spinner" size={16} /> : boundary.enabled ? <Check size={16} /> : <MapPin size={16} />}
              {boundary.enabled ? 'Disable boundary' : 'Use boundary'}
            </button>
          </> : <>
            <button className="btn btn-outline" type="button" onClick={() => { setParts([[]]); setActivePart(0); setSelectedVertex(null); setDirty(true); }} disabled={saving}><Plus size={16} /> Start new boundary</button>
            <button className="btn btn-outline" type="button" onClick={addPart} disabled={saving || parts.some((part) => part.length < 3)}><Plus size={16} /> Add polygon part</button>
            <button className="btn btn-outline" type="button" onClick={removeSelected} disabled={!selectedVertex || saving}><Trash2 size={16} /> Remove selected point</button>
            <button className="btn btn-outline" type="button" onClick={resetToSaved} disabled={!dirty || saving}><RotateCcw size={16} /> Reset</button>
            <button className="btn btn-outline" type="button" onClick={() => { resetToSaved(); setEditing(false); }} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" type="button" onClick={saveDraft} disabled={!valid || saving}>
              {saving ? <LoaderCircle className="boundary-spinner" size={16} /> : <Save size={16} />}
              Save boundary
            </button>
          </>}
        </div>
      </section>

      {editing && <section className="card municipality-boundary-edit-help">
        <CircleHelp size={17} />
        <span>Click to add a point. Drag a dot to move it; click a dot and use “Remove selected point” to delete it. Select a polygon part before adding more points. Every part needs at least 3 distinct points. To edit outside an active boundary, disable it before editing.</span>
        <label className="boundary-part-select">Editing part
          <select value={activePart} onChange={(event) => setActivePart(Number(event.target.value))}>
            {parts.map((part, index) => <option key={index} value={index}>Part {index + 1} ({part.length} points)</option>)}
          </select>
        </label>
      </section>}

      <section className="card municipality-boundary-map-card">
        {loading && <div className="boundary-loading"><LoaderCircle className="boundary-spinner" size={22} /> Loading saved boundary…</div>}
        <div className="municipality-boundary-map">
          <MapContainer center={DEFAULT_CENTER as LatLngExpression} zoom={10} scrollWheelZoom style={{ width: '100%', height: '100%', background: '#0b1120' }}>
            <TileLayer attribution={CARTO_ATTRIBUTION} url={CARTO_DARK_MAP_URL} />
            <FitDraft parts={parts} fitKey={fitKey} />
            {editing && <DraftMapEvents editing={editing} onAdd={addPoint} />}
            {parts.map((part, partIndex) => part.length >= 2 && (
              <Polygon
                key={`draft-part-${partIndex}`}
                positions={part as LatLngExpression[]}
                pathOptions={{ color: '#d6f5c8', weight: 3, fillColor: '#0d9488', fillOpacity: part.length >= 3 ? 0.12 : 0 }}
              />
            ))}
            {parts.flatMap((part, partIndex) => part.map(([latitude, longitude], pointIndex) => (
              <Marker
                key={`boundary-point-${partIndex}-${pointIndex}`}
                position={[latitude, longitude]}
                icon={createVertexIcon(pointIndex, selectedVertex?.part === partIndex && selectedVertex.index === pointIndex)}
                draggable={editing}
                eventHandlers={{
                  click: () => setSelectedVertex({ part: partIndex, index: pointIndex }),
                  dragend: (event) => {
                    const point = (event.target as L.Marker).getLatLng();
                    movePoint(partIndex, pointIndex, [point.lat, point.lng]);
                  },
                }}
              >
                <Tooltip direction="top">Part {partIndex + 1} · Point {pointIndex + 1}</Tooltip>
              </Marker>
            )))}
            <MunicipalityBoundaryMapLayer boundary={boundary} />
          </MapContainer>
        </div>
      </section>

      {!editing && <section className="card municipality-boundary-history">
        <div>
          <h2>Saved versions</h2>
          <p>Restore a previous boundary by saving that version as the current one.</p>
        </div>
        {history.length === 0
          ? <span className="field-help">No saved versions yet.</span>
          : <div className="boundary-history-list">
            {history.map((version) => (
              <button
                key={version.revision}
                type="button"
                className="btn btn-outline"
                disabled={saving || version.revision === boundary.revision}
                onClick={() => save(
                  version.geometry!,
                  version.enabled,
                  `Restore boundary version ${version.revision}? This will create a new saved revision.`,
                )}
              >
                <RotateCcw size={15} />
                <span>Restore v{version.revision} · {new Date(version.updated_at || '').toLocaleString()} · {version.enabled ? 'Enabled' : 'Disabled'}</span>
              </button>
            ))}
          </div>}
      </section>}
    </div>
  </>;
}
