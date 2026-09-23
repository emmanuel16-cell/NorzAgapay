import { useState, useRef } from 'react';
import {
  Megaphone,
  Plus,
  MoreVertical,
  Edit2,
  Trash2,
  X,
  Link as LinkIcon,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  ChevronsRight,
  ChevronsLeft,
  ExternalLink,
  Shield,
  AlertTriangle,
  Flame,
  CheckCircle,
  HandHeart,
  Eye,
  Calendar,
  User,
} from 'lucide-react';
import toast from 'react-hot-toast';

/* ─────────────────── Types ─────────────────── */
type BroadcastCategory =
  | 'disaster_yellow'
  | 'disaster_orange'
  | 'disaster_red'
  | 'safety_advisory'
  | 'relief_assistance'
  | 'all_clear';

interface BroadcastPost {
  id: string;
  barangayId: string;
  barangayName: string;
  authorName: string;
  category: BroadcastCategory;
  content: string;
  links: string[];
  media: string[];
  createdAt: Date;
  isFromMdrrmo?: boolean;
}

/* ─────────────────── Category Config ─────────────────── */
const CATEGORY_CONFIG: Record<
  BroadcastCategory,
  { label: string; color: string; bg: string; border: string; icon: React.ReactNode }
> = {
  disaster_yellow: {
    label: 'Disaster Alert',
    color: '#FBBF24',
    bg: 'rgba(251,191,36,0.12)',
    border: 'rgba(251,191,36,0.35)',
    icon: <AlertTriangle size={13} />,
  },
  disaster_orange: {
    label: 'Disaster Alert',
    color: '#F97316',
    bg: 'rgba(249,115,22,0.12)',
    border: 'rgba(249,115,22,0.35)',
    icon: <AlertTriangle size={13} />,
  },
  disaster_red: {
    label: 'Disaster Alert',
    color: '#EF4444',
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.35)',
    icon: <Flame size={13} />,
  },
  safety_advisory: {
    label: 'Safety Advisory',
    color: '#14B8A6',
    bg: 'rgba(20,184,166,0.12)',
    border: 'rgba(20,184,166,0.35)',
    icon: <Shield size={13} />,
  },
  relief_assistance: {
    label: 'Relief & Assistance',
    color: '#22C55E',
    bg: 'rgba(34,197,94,0.12)',
    border: 'rgba(34,197,94,0.35)',
    icon: <HandHeart size={13} />,
  },
  all_clear: {
    label: 'All-Clear Notice',
    color: '#3B82F6',
    bg: 'rgba(59,130,246,0.12)',
    border: 'rgba(59,130,246,0.35)',
    icon: <CheckCircle size={13} />,
  },
};

const CATEGORY_PILLS: { value: BroadcastCategory; sublabel?: string }[] = [
  { value: 'disaster_yellow', sublabel: 'Yellow' },
  { value: 'disaster_orange', sublabel: 'Orange' },
  { value: 'disaster_red', sublabel: 'Red' },
  { value: 'safety_advisory' },
  { value: 'relief_assistance' },
  { value: 'all_clear' },
];

/* ─────────────────── Category Sidebar Items (Matches img 1) ─────────────────── */
interface CategorySidebarItem {
  id: string;
  label: string;
  matches: (cat: BroadcastCategory) => boolean;
}

const CATEGORY_SIDEBAR_ITEMS: CategorySidebarItem[] = [
  { id: 'all', label: 'All Category', matches: () => true },
  { id: 'all_disaster', label: 'All Disaster Alert', matches: cat => cat.startsWith('disaster_') },
  { id: 'disaster_yellow', label: 'Disaster Alert · Yellow', matches: cat => cat === 'disaster_yellow' },
  { id: 'disaster_orange', label: 'Disaster Alert · Orange', matches: cat => cat === 'disaster_orange' },
  { id: 'disaster_red', label: 'Disaster Alert · Red', matches: cat => cat === 'disaster_red' },
  { id: 'safety_advisory', label: 'Safety Advisory', matches: cat => cat === 'safety_advisory' },
  { id: 'relief_assistance', label: 'Relief & Assistance', matches: cat => cat === 'relief_assistance' },
  { id: 'all_clear', label: 'All-Clear Notice', matches: cat => cat === 'all_clear' },
];

/* ─────────────────── MDRRMO Demo Broadcasts ─────────────────── */
const DEMO_POSTS: BroadcastPost[] = [
  {
    id: 'demo_1',
    barangayId: 'mdrrmo',
    barangayName: 'MDRRMO Norzagaray',
    authorName: 'MDRRMO Command',
    category: 'disaster_red',
    content:
      '🚨 RED ALERT: Severe flooding reported along Norzagaray River near Bigte Creek tributary. Water level has surpassed the critical threshold. All residents in low-lying areas of Purok 1, 2, and 3 are ordered to evacuate immediately to designated evacuation centers. MDRRMO rescue team and motorized boats deployed.',
    links: ['https://bagong.pagasa.dost.gov.ph', 'https://ndrrmc.gov.ph'],
    media: [
      'https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1514632595-4944383f2737?auto=format&fit=crop&w=800&q=80',
    ],
    createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    isFromMdrrmo: true,
  },
  {
    id: 'demo_2',
    barangayId: 'mdrrmo',
    barangayName: 'MDRRMO Norzagaray',
    authorName: 'MDRRMO Command',
    category: 'disaster_orange',
    content:
      '⚠️ MDRRMO ADVISORY: Angat and Ipo Dam water level update — Spillway gates may be opened at 2:00 AM due to sustained continuous rainfall from the enhanced Southwest Monsoon (Habagat). Low-lying riparian settlements in all barangays are advised to activate early evacuation protocols and stand-by rescue assets.',
    links: ['https://pagasa.dost.gov.ph'],
    media: [
      'https://images.unsplash.com/photo-1509114397022-ed747cca3f65?auto=format&fit=crop&w=800&q=80',
    ],
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    isFromMdrrmo: true,
  },
  {
    id: 'demo_3',
    barangayId: 'mdrrmo',
    barangayName: 'MDRRMO Norzagaray',
    authorName: 'MDRRMO Command',
    category: 'safety_advisory',
    content:
      'Norzagaray Emergency Operations Center (EOC) remains under heightened 24/7 Red Alert status. Preemptive sandbagging and drainage clearing ongoing along critical highway corridors. Please report blocked waterways or suspicious drainage issues to the MDRRMO command desk immediately. Hotline: 0917-123-MDRRMO.',
    links: [],
    media: [
      'https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=800&q=80',
    ],
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    isFromMdrrmo: true,
  },
  {
    id: 'demo_4',
    barangayId: 'mdrrmo',
    barangayName: 'MDRRMO Norzagaray',
    authorName: 'MDRRMO Command',
    category: 'relief_assistance',
    content:
      '📦 RELIEF DISTRIBUTION: Municipal Social Welfare and Development (MSWD) in coordination with MDRRMO has released 2,500 food packs and sanitation kits for distribution to evacuation centers across Norzagaray. Distribution staging areas are active in Poblacion, Bigte, and Minuyan shelters.',
    links: [],
    media: [
      'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?auto=format&fit=crop&w=800&q=80',
    ],
    createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
    isFromMdrrmo: true,
  },
  {
    id: 'demo_5',
    barangayId: 'mdrrmo',
    barangayName: 'MDRRMO Norzagaray',
    authorName: 'MDRRMO Command',
    category: 'all_clear',
    content:
      '✅ ALL-CLEAR NOTICE: Water levels across Norzagaray River and low-lying tributaries have subsided safely below alarm thresholds. Displaced residents in evacuation centers are cleared for safe and orderly return to their homes. Barangay health personnel are conducting area wellness checks.',
    links: [],
    media: [],
    createdAt: new Date(Date.now() - 14 * 60 * 60 * 1000),
    isFromMdrrmo: true,
  },
  {
    id: 'demo_6',
    barangayId: 'mdrrmo',
    barangayName: 'MDRRMO Norzagaray',
    authorName: 'MDRRMO Command',
    category: 'disaster_yellow',
    content:
      '🟡 YELLOW ALERT: Comprehensive river basin telemetry across Norzagaray River, Matictic Bridge, and Bigte Creek shows water level at Alert Level 2. Rescue vehicles and motorized boats have been pre-positioned at strategic response nodes. All BDRRMC chairs are advised to activate their contingency plans.',
    links: ['https://bagong.pagasa.dost.gov.ph'],
    media: [
      'https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1547683905-f686c993aae5?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1514632595-4944383f2737?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1509114397022-ed747cca3f65?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?auto=format&fit=crop&w=800&q=80',
      'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=800&q=80',
    ],
    createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000),
    isFromMdrrmo: true,
  },
];

/* ─────────────────── Helpers ─────────────────── */
function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/* ─────────────────── Category Pill ─────────────────── */
function CategoryPill({ category }: { category: BroadcastCategory }) {
  const cfg = CATEGORY_CONFIG[category];
  const sub =
    category === 'disaster_yellow' ? ' · Yellow' :
    category === 'disaster_orange' ? ' · Orange' :
    category === 'disaster_red'    ? ' · Red'    : '';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.3,
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
      }}
    >
      {cfg.icon}
      {cfg.label}
      {sub}
    </span>
  );
}

/* ─────────────────── Media Grid ─────────────────── */
function MediaGrid({ media, onImageClick }: { media: string[]; onImageClick: (idx: number) => void }) {
  if (media.length === 0) return null;
  const count = media.length;
  const MAX = 5;
  const extra = count > MAX ? count - MAX : 0;
  const visible = media.slice(0, MAX);

  const gridStyles: Record<number, React.CSSProperties> = {
    1: { gridTemplateColumns: '1fr', gridTemplateRows: '260px' },
    2: { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '220px' },
    3: { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '160px 160px' },
    4: { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '150px 150px' },
  };
  const containerStyle: React.CSSProperties =
    count >= 5
      ? { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: 'repeat(2,130px)', gap: 4 }
      : { display: 'grid', gap: 4, ...(gridStyles[count] || {}) };

  return (
    <div style={{ ...containerStyle, borderRadius: 12, overflow: 'hidden', marginTop: 12 }}>
      {visible.map((url, i) => {
        const isLast = i === MAX - 1 && extra > 0;
        const spanStyle: React.CSSProperties = count === 3 && i === 0 ? { gridRow: 'span 2' } : {};
        return (
          <div
            key={i}
            style={{ position: 'relative', overflow: 'hidden', cursor: 'pointer', ...spanStyle }}
            onClick={() => onImageClick(i)}
          >
            <img
              src={url}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                transition: 'transform 0.3s ease',
              }}
              onMouseOver={e => (e.currentTarget.style.transform = 'scale(1.05)')}
              onMouseOut={e => (e.currentTarget.style.transform = 'scale(1)')}
            />
            {isLast && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.65)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  gap: 4,
                }}
              >
                <Eye size={24} />
                <span style={{ fontSize: 22, fontWeight: 800 }}>+{extra}</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>View all</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────── Lightbox ─────────────────── */
function Lightbox({ media, startIndex, onClose }: { media: string[]; startIndex: number; onClose: () => void }) {
  const [current, setCurrent] = useState(startIndex);
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.93)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 20,
          right: 24,
          background: 'rgba(255,255,255,0.1)',
          border: 'none',
          color: '#fff',
          borderRadius: 8,
          padding: '8px 14px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 14,
        }}
      >
        <X size={18} /> Close
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }} onClick={e => e.stopPropagation()}>
        <button
          disabled={current === 0}
          onClick={() => setCurrent(c => c - 1)}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: '#fff',
            borderRadius: '50%',
            width: 44,
            height: 44,
            cursor: current === 0 ? 'not-allowed' : 'pointer',
            opacity: current === 0 ? 0.3 : 1,
            fontSize: 22,
          }}
        >
          ‹
        </button>
        <img
          src={media[current]}
          alt=""
          style={{ maxWidth: '70vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.8)' }}
        />
        <button
          disabled={current === media.length - 1}
          onClick={() => setCurrent(c => c + 1)}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: 'none',
            color: '#fff',
            borderRadius: '50%',
            width: 44,
            height: 44,
            cursor: current === media.length - 1 ? 'not-allowed' : 'pointer',
            opacity: current === media.length - 1 ? 0.3 : 1,
            fontSize: 22,
          }}
        >
          ›
        </button>
      </div>
      <div style={{ color: 'rgba(255,255,255,0.5)', marginTop: 16, fontSize: 13 }}>
        {current + 1} / {media.length}
      </div>
    </div>
  );
}

/* ─────────────────── Post Card (MDRRMO Broadcast) ─────────────────── */
function PostCard({ post, onEdit, onDelete }: { post: BroadcastPost; onEdit: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const cfg = CATEGORY_CONFIG[post.category];
  const LIMIT = 220;
  const needsTrunc = post.content.length > LIMIT;
  const displayContent = needsTrunc && !expanded ? post.content.slice(0, LIMIT) + '…' : post.content;

  return (
    <div
      className="card"
      style={{
        marginBottom: 16,
        borderLeft: `4px solid ${cfg.color}`,
        position: 'relative',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Avatar */}
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              background: 'rgba(56, 189, 248, 0.15)',
              border: `2px solid ${cfg.color}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 16,
              fontWeight: 800,
              color: cfg.color,
            }}
          >
            M
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 15, letterSpacing: -0.2 }}>
                {post.barangayName}
              </span>
              <CategoryPill category={post.category} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <User size={11} /> {post.authorName}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={11} /> {timeAgo(post.createdAt)}
              </span>
            </div>
          </div>
        </div>

        {/* 3-dot menu */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <MoreVertical size={18} />
          </button>
          {menuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setMenuOpen(false)} />
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '110%',
                  background: 'var(--bg-elevated, #1E293B)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 100,
                  minWidth: 160,
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    textAlign: 'left',
                  }}
                  onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                  onMouseOut={e => (e.currentTarget.style.background = 'none')}
                >
                  <Edit2 size={14} /> Edit Post
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: 'none',
                    border: 'none',
                    color: '#EF4444',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    textAlign: 'left',
                  }}
                  onMouseOver={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.07)')}
                  onMouseOut={e => (e.currentTarget.style.background = 'none')}
                >
                  <Trash2 size={14} /> Remove Post
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <p style={{ color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.65, margin: 0 }}>
        {displayContent}
        {needsTrunc && (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: '#38BDF8',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              marginLeft: 4,
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            {expanded ? <><ChevronUp size={13} /> See less</> : <><ChevronDown size={13} /> See more</>}
          </button>
        )}
      </p>

      {/* Media Grid */}
      {post.media.length > 0 && <MediaGrid media={post.media} onImageClick={i => setLightboxIdx(i)} />}

      {/* Links */}
      {post.links.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {post.links.map((link, i) => {
            let hostname = link;
            try {
              hostname = new URL(link).hostname;
            } catch (_) {}
            return (
              <a
                key={i}
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: 'rgba(56,189,248,0.08)',
                  border: '1px solid rgba(56,189,248,0.2)',
                  color: '#38BDF8',
                  fontSize: 12,
                  textDecoration: 'none',
                  transition: 'all 0.2s',
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'rgba(56,189,248,0.15)')}
                onMouseOut={e => (e.currentTarget.style.background = 'rgba(56,189,248,0.08)')}
              >
                <ExternalLink size={11} />
                {hostname}
              </a>
            );
          })}
        </div>
      )}

      {lightboxIdx !== null && (
        <Lightbox media={post.media} startIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} />
      )}
    </div>
  );
}

/* ─────────────────── Create / Edit Modal (Only for MDRRMO) ─────────────────── */
const EMPTY_FORM = {
  category: 'safety_advisory' as BroadcastCategory,
  content: '',
  links: [''],
  media: [] as string[],
};

function CreateModal({
  existing,
  onClose,
  onSave,
}: {
  existing: BroadcastPost | null;
  onClose: () => void;
  onSave: (p: BroadcastPost) => void;
}) {
  const [form, setForm] = useState(
    existing
      ? {
          category: existing.category,
          content: existing.content,
          links: existing.links.length > 0 ? existing.links : [''],
          media: existing.media,
        }
      : { ...EMPTY_FORM }
  );
  const [mediaInput, setMediaInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const addLink = () => setForm(f => ({ ...f, links: [...f.links, ''] }));
  const removeLink = (i: number) => setForm(f => ({ ...f, links: f.links.filter((_, idx) => idx !== i) }));
  const setLink = (i: number, val: string) =>
    setForm(f => ({ ...f, links: f.links.map((l, idx) => (idx === i ? val : l)) }));
  const addMediaUrl = () => {
    if (!mediaInput.trim()) return;
    setForm(f => ({ ...f, media: [...f.media, mediaInput.trim()] }));
    setMediaInput('');
  };
  const removeMedia = (i: number) => setForm(f => ({ ...f, media: f.media.filter((_, idx) => idx !== i) }));

  const handleSave = () => {
    if (!form.content.trim()) {
      toast.error('Post content cannot be empty');
      return;
    }
    const post: BroadcastPost = {
      id: existing?.id ?? `post_${Date.now()}`,
      barangayId: 'mdrrmo',
      barangayName: 'MDRRMO Norzagaray',
      authorName: 'MDRRMO Command',
      category: form.category,
      content: form.content,
      links: form.links.filter(l => l.trim() !== ''),
      media: form.media,
      createdAt: existing?.createdAt ?? new Date(),
      isFromMdrrmo: true,
    };
    onSave(post);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-primary, #0F172A)',
    border: '1px solid var(--border-color, #334155)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    padding: '9px 12px',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-card, #1E293B)',
          border: '1px solid var(--border-color, #334155)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 620,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid var(--border-color, #334155)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Megaphone size={20} color="#38BDF8" />
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
              {existing ? 'Edit Alert Broadcast' : 'Create MDRRMO Alert Broadcast'}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Category Pills */}
          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                display: 'block',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Category
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORY_PILLS.map(({ value, sublabel }) => {
                const cfg = CATEGORY_CONFIG[value];
                const isSelected = form.category === value;
                return (
                  <button
                    key={value}
                    onClick={() => setForm(f => ({ ...f, category: value }))}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 13px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: `2px solid ${isSelected ? cfg.color : cfg.border}`,
                      background: isSelected ? cfg.bg : 'transparent',
                      color: isSelected ? cfg.color : 'var(--text-muted)',
                      transition: 'all 0.2s',
                      transform: isSelected ? 'scale(1.04)' : 'scale(1)',
                    }}
                  >
                    {cfg.icon}
                    {cfg.label}
                    {sublabel && <span style={{ opacity: 0.75 }}>· {sublabel}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                display: 'block',
                marginBottom: 6,
              }}
            >
              Broadcast Content <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <textarea
              style={{ ...inputStyle, minHeight: 130, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Write the municipal emergency advisory or broadcast here…"
            />
          </div>

          {/* Links */}
          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                display: 'block',
                marginBottom: 6,
              }}
            >
              Reference Links
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {form.links.map((link, i) => (
                <div key={i} style={{ display: 'flex', gap: 6 }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <LinkIcon
                      size={13}
                      style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                    />
                    <input
                      style={{ ...inputStyle, paddingLeft: 30 }}
                      value={link}
                      onChange={e => setLink(i, e.target.value)}
                      placeholder="https://…"
                    />
                  </div>
                  <button
                    onClick={() => removeLink(i)}
                    style={{
                      background: 'rgba(239,68,68,0.1)',
                      border: '1px solid rgba(239,68,68,0.2)',
                      color: '#EF4444',
                      borderRadius: 8,
                      padding: '0 10px',
                      cursor: 'pointer',
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={addLink}
                style={{
                  background: 'none',
                  border: '1px dashed var(--border-hover, #475569)',
                  color: 'var(--text-secondary)',
                  borderRadius: 8,
                  padding: '7px',
                  cursor: 'pointer',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Plus size={13} /> Add another link
              </button>
            </div>
          </div>

          {/* Media */}
          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                display: 'block',
                marginBottom: 6,
              }}
            >
              Images / Photos
            </label>
            {form.media.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {form.media.map((url, i) => (
                  <div key={i} style={{ position: 'relative', width: 72, height: 72 }}>
                    <img
                      src={url}
                      alt=""
                      style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-color)' }}
                    />
                    <button
                      onClick={() => removeMedia(i)}
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -6,
                        background: '#EF4444',
                        border: 'none',
                        color: '#fff',
                        borderRadius: '50%',
                        width: 20,
                        height: 20,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <ImageIcon
                  size={13}
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                />
                <input
                  style={{ ...inputStyle, paddingLeft: 30 }}
                  value={mediaInput}
                  onChange={e => setMediaInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addMediaUrl()}
                  placeholder="Paste image URL and press Enter…"
                />
              </div>
              <button
                onClick={addMediaUrl}
                style={{
                  background: 'rgba(56,189,248,0.1)',
                  border: '1px solid rgba(56,189,248,0.25)',
                  color: '#38BDF8',
                  borderRadius: 8,
                  padding: '0 12px',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Add
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} />
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--border-color, #334155)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Megaphone size={15} />
            {existing ? 'Update Broadcast' : 'Publish Broadcast'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Delete Modal ─────────────────── */
function DeleteModal({
  post,
  onClose,
  onConfirm,
}: {
  post: BroadcastPost;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 2100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-card, #1E293B)',
          border: '1px solid var(--border-color, #334155)',
          borderRadius: 14,
          padding: '28px 28px 22px',
          maxWidth: 420,
          width: '90%',
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Trash2 size={20} color="#EF4444" />
          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 16 }}>Remove Broadcast</h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, margin: '0 0 20px' }}>
          Are you sure you want to remove this alert broadcast? Residents across Norzagaray will no longer see this notification.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" style={{ background: '#EF4444', color: '#fff', border: 'none' }} onClick={onConfirm}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Main Page ─────────────────── */
export default function AlertBroadcastsPage() {
  const [posts, setPosts] = useState<BroadcastPost[]>(DEMO_POSTS);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editPost, setEditPost] = useState<BroadcastPost | null>(null);
  const [deletePost, setDeletePost] = useState<BroadcastPost | null>(null);

  const activeCategoryItem = CATEGORY_SIDEBAR_ITEMS.find(c => c.id === selectedCategory);

  const filtered = posts.filter(p => {
    if (!activeCategoryItem) return true;
    return activeCategoryItem.matches(p.category);
  });

  const handleSave = (post: BroadcastPost) => {
    setPosts(prev => {
      const idx = prev.findIndex(p => p.id === post.id);
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = post;
        toast.success('Broadcast updated successfully!');
        return updated;
      }
      toast.success('Broadcast published successfully!');
      return [post, ...prev];
    });
    setCreateOpen(false);
    setEditPost(null);
  };

  const handleDelete = () => {
    if (!deletePost) return;
    setPosts(prev => prev.filter(p => p.id !== deletePost.id));
    toast.success('Broadcast removed.');
    setDeletePost(null);
  };

  return (
    <>
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(56, 189, 248, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38BDF8',
            }}
          >
            <Megaphone size={22} />
          </div>
          <div>
            <h1 className="page-title" style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
              Alert Broadcasts
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Manage public alert posts across all barangays
            </p>
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditPost(null);
            setCreateOpen(true);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', fontWeight: 700 }}
        >
          <Plus size={16} /> Create Post
        </button>
      </div>

      <div className="page-content" style={{ padding: '0 24px 32px' }}>
        {/* Main Content Area: Responsive Feed on Left + Fixed Collapsible Category Panel on Right (Matches img 1) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 20,
            position: 'relative',
            width: '100%',
          }}
        >
          {/* Feed Column - adapts width automatically when category panel expands or minimizes */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {/* When category sidebar is minimized, show expand trigger button on top right of feed */}
            {!sidebarOpen && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button
                  onClick={() => setSidebarOpen(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: 'var(--bg-card, #1E293B)',
                    border: '1px solid var(--border-color, #334155)',
                    color: '#38BDF8',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-sm)',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={e => (e.currentTarget.style.borderColor = '#38BDF8')}
                  onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border-color, #334155)')}
                >
                  <ChevronsLeft size={16} />
                  <span>Show Categories ({activeCategoryItem?.label ?? 'All'})</span>
                </button>
              </div>
            )}

            {/* Posts List */}
            {filtered.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '60px 24px' }}>
                <Megaphone size={44} color="var(--text-muted)" style={{ marginBottom: 14 }} />
                <h3 style={{ margin: '0 0 6px', color: 'var(--text-primary)', fontSize: 16 }}>
                  No alert broadcasts found
                </h3>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
                  {selectedCategory !== 'all'
                    ? 'No posts in this category. Try selecting "All Category".'
                    : 'Click "Create Post" to publish a new alert broadcast.'}
                </p>
              </div>
            ) : (
              filtered.map(post => (
                <PostCard
                  key={post.id}
                  post={post}
                  onEdit={() => setEditPost(post)}
                  onDelete={() => setDeletePost(post)}
                />
              ))
            )}
          </div>

          {/* Category List Sidebar (Fixed / Collapsible on Right - Matches img 1) */}
          {sidebarOpen && (
            <div
              style={{
                width: 250,
                flexShrink: 0,
                position: 'sticky',
                top: 24,
                background: 'var(--bg-card, #1E293B)',
                border: '1px solid var(--border-color, #334155)',
                borderRadius: 16,
                padding: '12px 14px 16px',
                boxShadow: 'var(--shadow-md)',
                transition: 'all 0.3s ease',
              }}
            >
              {/* Header with >> minimize toggle button */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button
                  onClick={() => setSidebarOpen(false)}
                  title="Minimize category list"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted, #94A3B8)',
                    cursor: 'pointer',
                    padding: '4px 6px',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    transition: 'color 0.2s',
                  }}
                  onMouseOver={e => (e.currentTarget.style.color = '#fff')}
                  onMouseOut={e => (e.currentTarget.style.color = 'var(--text-muted, #94A3B8)')}
                >
                  <ChevronsRight size={18} />
                </button>
              </div>

              {/* Category button items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {CATEGORY_SIDEBAR_ITEMS.map(item => {
                  const isSelected = selectedCategory === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedCategory(item.id)}
                      style={{
                        width: '100%',
                        padding: '11px 14px',
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: isSelected ? 700 : 600,
                        textAlign: 'center',
                        cursor: 'pointer',
                        border: isSelected ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid rgba(51, 65, 85, 0.4)',
                        background: isSelected
                          ? 'rgba(56, 189, 248, 0.16)'
                          : 'rgba(15, 23, 42, 0.5)',
                        color: isSelected ? '#38BDF8' : 'var(--text-secondary, #94A3B8)',
                        transition: 'all 0.18s ease',
                        boxShadow: isSelected ? '0 0 12px rgba(56, 189, 248, 0.12)' : 'none',
                      }}
                      onMouseOver={e => {
                        if (!isSelected) {
                          e.currentTarget.style.background = 'rgba(51, 65, 85, 0.4)';
                          e.currentTarget.style.color = '#fff';
                        }
                      }}
                      onMouseOut={e => {
                        if (!isSelected) {
                          e.currentTarget.style.background = 'rgba(15, 23, 42, 0.5)';
                          e.currentTarget.style.color = 'var(--text-secondary, #94A3B8)';
                        }
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {(createOpen || editPost) && (
        <CreateModal
          existing={editPost}
          onClose={() => {
            setCreateOpen(false);
            setEditPost(null);
          }}
          onSave={handleSave}
        />
      )}
      {deletePost && (
        <DeleteModal
          post={deletePost}
          onClose={() => setDeletePost(null)}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}
