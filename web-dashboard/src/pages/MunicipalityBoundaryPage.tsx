import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Check, CircleHelp, LoaderCircle, MapPin, Pencil, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { municipalityBoundaryAPI } from '../lib/api';
import { boundaryPolygons, type BoundaryGeometry, type MunicipalityBoundary } from '../lib/municipalityBoundary';
import { useMunicipalityBoundary } from '../context/MunicipalityBoundaryContext';
import MunicipalityBoundaryMapLayer from '../components/MunicipalityBoundaryMapLayer';
import { CARTO_ATTRIBUTION, CARTO_DARK_MAP_URL } from '../lib/mapConfig';

type Point = [number, number]; // latitude, longitude for Leaflet
type DraftPart = Point[];
type BoundaryConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<boolean>;
};
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
  const [selectedVersion, setSelectedVersion] = useState<MunicipalityBoundary | null>(null);
  const [confirmation, setConfirmation] = useState<BoundaryConfirmation | null>(null);

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

  const save = async (geometry: BoundaryGeometry, enabled: boolean, expectedRevision = boundary.revision) => {
    setSaving(true);
    try {
      const response = await municipalityBoundaryAPI.save({
        geometry,
        enabled,
        expectedRevision,
        expectedUpdatedAt: boundary.updated_at ?? null,
      });
      const next = responseConfig(response.data);
      setBoundary(next);
      void loadHistory();
      setParts(geometryToParts(next.geometry));
      setDirty(false);
      setEditing(false);
      setSelectedVertex(null);
      setSelectedVersion(null);
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

  const requestSaveConfirmation = (
    geometry: BoundaryGeometry,
    enabled: boolean,
    message: string,
    options: { title: string; confirmLabel: string; expectedRevision?: number; danger?: boolean },
  ) => {
    setConfirmation({
      ...options,
      message,
      action: () => save(geometry, enabled, options.expectedRevision),
    });
  };

  const runConfirmation = async () => {
    if (!confirmation || saving) return;
    const succeeded = await confirmation.action();
    if (succeeded) setConfirmation(null);
  };

  const changeEnabled = async (enabled: boolean) => {
    if (!boundary.geometry || !isValidParts(geometryToParts(boundary.geometry))) {
      toast.error('Create and save a boundary with at least three points first.');
      return;
    }
    requestSaveConfirmation(
      boundary.geometry,
      enabled,
      enabled
        ? 'Use this boundary across the web dashboard, mobile app, and resident app? Web dashboard maps will show white outside it, and location/report checks will use it.'
        : 'Disable the municipality boundary across all apps? Full maps will be visible and boundary-based restrictions will stop.',
      {
        title: enabled ? 'Use this boundary?' : 'Disable this boundary?',
        confirmLabel: enabled ? 'Use boundary' : 'Disable boundary',
        danger: !enabled,
      },
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

  const saveDraft = () => {
    if (!valid || !draftGeometry) {
      toast.error('Add at least three distinct points to every boundary part.');
      return;
    }
    requestSaveConfirmation(
      draftGeometry,
      boundary.enabled,
      `Save this ${parts.reduce((sum, part) => sum + part.length, 0)}-point municipality boundary${boundary.enabled ? ' and apply it across all apps' : ''}?`,
      {
        title: 'Save boundary?',
        confirmLabel: boundary.enabled ? 'Save and apply' : 'Save boundary',
        expectedRevision: editRevision,
      },
    );
  };

  const startNewBoundary = () => {
    setSelectedVersion(null);
    setEditing(true);
    setParts([[]]);
    setActivePart(0);
    setSelectedVertex(null);
    setDirty(true);
    setEditRevision(boundary.revision);
  };

  const editVersion = (version: MunicipalityBoundary) => {
    if (!version.geometry) return;
    setParts(geometryToParts(version.geometry));
    setActivePart(0);
    setSelectedVertex(null);
    setEditing(true);
    setDirty(false);
    setEditRevision(boundary.revision);
    setSelectedVersion(null);
  };

  const useVersion = (version: MunicipalityBoundary) => {
    if (!version.geometry) return;
    setConfirmation({
      title: `Use boundary ${version.revision}?`,
      message: `Use this saved boundary across the web dashboard, mobile app, and resident app? It will activate revision ${version.revision} without creating a new revision.`,
      confirmLabel: 'Use boundary',
      action: async () => {
        setSaving(true);
        try {
          const response = await municipalityBoundaryAPI.useVersion(version.revision, {
            expectedRevision: boundary.revision,
            expectedUpdatedAt: boundary.updated_at ?? null,
          });
          const next = responseConfig(response.data);
          setBoundary(next);
          void loadHistory();
          setParts(geometryToParts(next.geometry));
          setDirty(false);
          setEditing(false);
          setSelectedVertex(null);
          setSelectedVersion(null);
          toast.success(`Boundary ${version.revision} is now in use across all app maps.`);
          return true;
        } catch (error: any) {
          const message = error?.response?.data?.error;
          toast.error(typeof message === 'string' ? message : 'Could not use this boundary version.');
          return false;
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const deleteVersion = async (version: MunicipalityBoundary) => {
    if (version.revision === boundary.revision) return false;
    setSaving(true);
    try {
      await municipalityBoundaryAPI.deleteVersion(version.revision);
      await loadHistory();
      setSelectedVersion(null);
      toast.success(`Boundary version ${version.revision} deleted.`);
      return true;
    } catch (error: any) {
      const message = error?.response?.data?.error;
      toast.error(typeof message === 'string' ? message : 'Could not delete this boundary version.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteVersion = (version: MunicipalityBoundary) => {
    if (version.revision === boundary.revision) return;
    setConfirmation({
      title: `Delete boundary ${version.revision}?`,
      message: 'This saved version will be permanently removed. The boundary currently in use cannot be deleted.',
      confirmLabel: 'Delete boundary',
      danger: true,
      action: () => deleteVersion(version),
    });
  };

  const displayedVersions = [...history]
    .filter((version) => version.revision !== boundary.revision)
    .sort((left, right) => right.revision - left.revision);

  return <>
    <div className="page-header municipality-boundary-page-header">
      <h1 className="page-title">Municipality Boundary</h1>
    </div>
    <div className="page-content municipality-boundary-page">
      <section className="card municipality-boundary-controls">
        <div className="municipality-boundary-status">
          <div className={`boundary-status-pill ${boundary.enabled ? 'enabled' : 'disabled'}`}>
            <span className="boundary-status-dot" />
            {boundary.enabled ? 'Boundary in use' : 'Full map in use'}
          </div>
          <p>{boundary.enabled
            ? 'Web dashboard maps show white outside this boundary. Location and resident report checks use this shape across apps.'
            : 'No boundary restriction is active. All app maps show the full map.'}</p>
        </div>
        <div className="municipality-boundary-summary">Boundary {Math.max(1, boundary.revision)} <span>|</span> {boundary.enabled ? 'Enabled' : 'Disabled'}</div>
      </section>

      <section className="card municipality-boundary-toolbar" aria-label="Boundary editing actions">
        <div className="municipality-boundary-actions">
          <button className="btn btn-outline" type="button" onClick={startNewBoundary} disabled={saving || loading}>
            <Plus size={16} /> Add boundary
          </button>
          {!editing ? <>
            <button className="btn btn-outline" type="button" onClick={() => { setEditing(true); setDirty(false); setEditRevision(boundary.revision); }} disabled={loading || saving}>
              <MapPin size={16} /> Edit selected boundary
            </button>
            <button className={`btn ${boundary.enabled ? 'btn-outline' : 'btn-primary'}`} type="button" onClick={() => changeEnabled(!boundary.enabled)} disabled={saving || loading}>
              {saving ? <LoaderCircle className="boundary-spinner" size={16} /> : boundary.enabled ? <Check size={16} /> : <MapPin size={16} />}
              {boundary.enabled ? 'Disable boundary' : 'Use boundary'}
            </button>
          </> : <>
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

      {editing && <section className="municipality-boundary-edit-help">
        <CircleHelp size={16} />
        <span>Click to add a point; drag a dot to move it. Every polygon part needs at least 3 distinct points.</span>
        <label className="boundary-part-select">Editing part
          <select value={activePart} onChange={(event) => setActivePart(Number(event.target.value))}>
            {parts.map((part, index) => <option key={index} value={index}>Part {index + 1} ({part.length} points)</option>)}
          </select>
        </label>
      </section>}

      <section className="municipality-boundary-workspace">
        <aside className="card municipality-boundary-version-panel" aria-label="Saved boundaries">
          <div className="municipality-boundary-version-heading">Boundaries</div>
          <button
            type="button"
            className={`municipality-boundary-version active${selectedVersion?.revision === boundary.revision ? ' selected' : ''}`}
            aria-pressed={selectedVersion?.revision === boundary.revision}
            onClick={() => setSelectedVersion(boundary)}
            disabled={saving || editing || !boundary.geometry}
            title="Boundary currently selected for all apps"
          >
            <strong>Boundary {Math.max(1, boundary.revision)}</strong>
            <span>Current · {boundary.enabled ? 'Enabled' : 'Disabled'}</span>
          </button>
          {displayedVersions.map((version) => (
            <button
              key={version.revision}
              type="button"
              className={`municipality-boundary-version${selectedVersion?.revision === version.revision ? ' selected' : ''}`}
              aria-pressed={selectedVersion?.revision === version.revision}
              disabled={saving || editing || !version.geometry}
              title={`View actions for boundary version ${version.revision}`}
              onClick={() => setSelectedVersion(version)}
            >
              <strong>Boundary {version.revision}</strong>
              <span>Saved version · {version.enabled ? 'Enabled' : 'Disabled'}</span>
            </button>
          ))}
          <button
            type="button"
            className="municipality-boundary-add-version"
            onClick={editing ? addPart : startNewBoundary}
            disabled={saving || loading || (editing && parts.some((part) => part.length < 3))}
            aria-label={editing ? 'Add polygon part' : 'Add boundary'}
            title={editing ? 'Add polygon part' : 'Add boundary'}
          >
            <Plus size={24} />
          </button>
        </aside>

        <section className="card municipality-boundary-map-card">
          {loading && <div className="boundary-loading"><LoaderCircle className="boundary-spinner" size={22} /> Loading saved boundary…</div>}
          <div className="municipality-boundary-map">
            <MapContainer center={DEFAULT_CENTER as LatLngExpression} zoom={10} scrollWheelZoom style={{ width: '100%', height: '100%', background: '#ffffff' }}>
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
      </section>
    </div>
    {selectedVersion && !confirmation && <div className="modal-backdrop municipality-boundary-modal-backdrop" onClick={() => { if (!saving) setSelectedVersion(null); }}>
      <section className="modal municipality-boundary-modal" role="dialog" aria-modal="true" aria-labelledby="boundary-version-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="boundary-version-modal-title">Boundary {selectedVersion.revision}</h2>
            <p className="municipality-boundary-modal-subtitle">
              {selectedVersion.revision === boundary.revision ? 'Currently selected for the system' : 'Saved boundary version'}
            </p>
          </div>
          <button className="modal-close" type="button" aria-label="Close" onClick={() => setSelectedVersion(null)} disabled={saving}><X size={20} /></button>
        </div>
        <div className="municipality-boundary-modal-details">
          <span className={`boundary-status-pill ${selectedVersion.enabled ? 'enabled' : 'disabled'}`}>
            <span className="boundary-status-dot" />
            {selectedVersion.revision === boundary.revision && selectedVersion.enabled ? 'In use' : selectedVersion.enabled ? 'Enabled when saved' : 'Disabled when saved'}
          </span>
          {selectedVersion.updated_at && <span>Saved {new Date(selectedVersion.updated_at).toLocaleString()}</span>}
          <span>{geometryToParts(selectedVersion.geometry).reduce((total, part) => total + part.length, 0)} boundary points</span>
        </div>
        <p className="municipality-boundary-modal-copy">
          Choose what to do with this boundary. Editing creates a new saved revision when you save; using it applies its shape across all apps.
        </p>
        <div className="municipality-boundary-modal-actions">
          <button className="btn btn-outline" type="button" onClick={() => editVersion(selectedVersion)} disabled={!selectedVersion.geometry || saving}>
            <Pencil size={16} /> Edit
          </button>
          <button className="btn btn-primary" type="button" onClick={() => useVersion(selectedVersion)} disabled={!selectedVersion.geometry || saving || (selectedVersion.revision === boundary.revision && boundary.enabled)}>
            {saving ? <LoaderCircle className="boundary-spinner" size={16} /> : <Check size={16} />}
            {selectedVersion.revision === boundary.revision && boundary.enabled ? 'Already in use' : 'Use boundary'}
          </button>
          <button className="btn btn-danger" type="button" onClick={() => requestDeleteVersion(selectedVersion)} disabled={saving || selectedVersion.revision === boundary.revision}>
            {saving ? <LoaderCircle className="boundary-spinner" size={16} /> : <Trash2 size={16} />}
            Delete
          </button>
        </div>
        {selectedVersion.revision === boundary.revision && <p className="municipality-boundary-delete-note">The boundary currently selected for the system cannot be deleted. Use another saved version first.</p>}
      </section>
    </div>}
    {confirmation && <div className="modal-backdrop municipality-boundary-modal-backdrop" onClick={() => { if (!saving) setConfirmation(null); }}>
      <section className="modal municipality-boundary-modal municipality-boundary-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="boundary-confirmation-title" aria-describedby="boundary-confirmation-message" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" id="boundary-confirmation-title">{confirmation.title}</h2>
          <button className="modal-close" type="button" aria-label="Close" onClick={() => setConfirmation(null)} disabled={saving}><X size={20} /></button>
        </div>
        <p className="municipality-boundary-modal-copy" id="boundary-confirmation-message">{confirmation.message}</p>
        <div className="municipality-boundary-modal-actions">
          <button className="btn btn-outline" type="button" onClick={() => setConfirmation(null)} disabled={saving}>Cancel</button>
          <button className={`btn ${confirmation.danger ? 'btn-danger' : 'btn-primary'}`} type="button" onClick={() => void runConfirmation()} disabled={saving}>
            {saving && <LoaderCircle className="boundary-spinner" size={16} />}
            {confirmation.confirmLabel}
          </button>
        </div>
      </section>
    </div>}
  </>;
}
