import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ExternalLink, Megaphone, RefreshCw, Share2, Edit3, Trash2 } from 'lucide-react';

export type CommunityAlert = {
  id: string;
  barangay_id?: string | null;
  barangay_name?: string;
  author_name?: string;
  category?: string;
  content?: string;
  is_mdrrmo?: boolean;
  is_from_mdrrmo?: boolean;
  is_pinned?: boolean;
  created_at?: string;
  links?: string[];
  media?: Array<{ url: string; type?: string }>;
};

type Source = 'all' | 'barangay' | 'mdrrmo' | 'pinned';
type Props = {
  posts: CommunityAlert[];
  barangays: string[];
  initialBarangay?: string;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  canPinPost?: (post: CommunityAlert) => boolean;
  onToggleServerPin?: (post: CommunityAlert) => void;
  canEditPost?: (post: CommunityAlert) => boolean;
  onEditPost?: (post: CommunityAlert) => void;
  canRemovePost?: (post: CommunityAlert) => boolean;
  onRemovePost?: (post: CommunityAlert) => void;
  canRepostPost?: (post: CommunityAlert) => boolean;
  onRepostPost?: (post: CommunityAlert) => void;
};

const alertCategories = [
  { id: 'all', label: 'All updates' }, { id: 'all_disaster', label: 'Disaster alerts' },
  { id: 'disaster_red', label: 'Red alert' }, { id: 'disaster_orange', label: 'Orange alert' },
  { id: 'disaster_yellow', label: 'Yellow alert' }, { id: 'safety_advisory', label: 'Safety' },
  { id: 'relief_assistance', label: 'Relief & assistance' }, { id: 'all_clear', label: 'All clear' },
];

function normalizeCategory(category?: string) {
  return ({ disaster_alert_yellow: 'disaster_yellow', disaster_alert_orange: 'disaster_orange', disaster_alert_red: 'disaster_red', all_clear_notice: 'all_clear' } as Record<string, string>)[category || ''] || category || 'safety_advisory';
}
function categoryName(category?: string) {
  return alertCategories.find((item) => item.id === normalizeCategory(category))?.label || (category || 'Safety advisory').replaceAll('_', ' ');
}
function formatDate(value?: string) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function normalizeBarangay(value?: string) {
  return String(value || '').trim().toLowerCase().replace(/^barangay\s+/i, '');
}

export default function CommunityAlertsBoard({
  posts, barangays, initialBarangay = '', loading, error = '', onRefresh,
  canPinPost, onToggleServerPin, canEditPost, onEditPost, canRemovePost, onRemovePost,
  canRepostPost, onRepostPost,
}: Props) {
  const [source, setSource] = useState<Source>('all');
  const [category, setCategory] = useState('all');
  const [selectedBarangay, setSelectedBarangay] = useState(initialBarangay);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches);
  const [localPins, setLocalPins] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('resident_pinned_broadcasts') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    const viewport = window.matchMedia('(max-width: 768px)');
    const updateViewport = () => setIsMobile(viewport.matches);
    updateViewport();
    viewport.addEventListener('change', updateViewport);
    return () => viewport.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    setSelectedBarangay((current) => current || initialBarangay);
  }, [initialBarangay]);

  const isPinned = (post: CommunityAlert) => {
    const key = `${post.is_mdrrmo === false ? 'barangay' : 'mdrrmo'}:${post.id}`;
    return Boolean(localPins.includes(key) || (canPinPost?.(post) && post.is_pinned));
  };
  const togglePin = (post: CommunityAlert) => {
    if (canPinPost?.(post) && onToggleServerPin) {
      onToggleServerPin(post);
      return;
    }
    const key = `${post.is_mdrrmo === false ? 'barangay' : 'mdrrmo'}:${post.id}`;
    const next = localPins.includes(key) ? localPins.filter((item) => item !== key) : [...localPins, key];
    setLocalPins(next);
    localStorage.setItem('resident_pinned_broadcasts', JSON.stringify(next));
  };
  const categoryMatches = (post: CommunityAlert) => {
    const normalized = normalizeCategory(post.category);
    return category === 'all' || (category === 'all_disaster' ? normalized.startsWith('disaster_') : normalized === category);
  };
  const isVerifiedLocalPost = (post: CommunityAlert) => post.is_mdrrmo === false
    && barangays.some((name) => normalizeBarangay(name) === normalizeBarangay(post.barangay_name));
  const selectedLocalPost = (post: CommunityAlert) => !selectedBarangay
    || normalizeBarangay(post.barangay_name) === normalizeBarangay(selectedBarangay);
  const sortPosts = (items: CommunityAlert[]) => [...items].sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''));

  const barangayPosts = sortPosts(posts.filter((post) => isVerifiedLocalPost(post) && selectedLocalPost(post) && categoryMatches(post)));
  const mdrrmoPosts = sortPosts(posts.filter((post) => post.is_mdrrmo !== false && categoryMatches(post)));
  const mobilePosts = sortPosts(posts.filter((post) => {
    const isMdrrmo = post.is_mdrrmo !== false;
    if (!isMdrrmo && !isVerifiedLocalPost(post)) return false;
    if (!isMdrrmo && source !== 'pinned' && !selectedLocalPost(post)) return false;
    if (source === 'barangay' && isMdrrmo) return false;
    if (source === 'mdrrmo' && !isMdrrmo) return false;
    if (source === 'pinned' && !isPinned(post)) return false;
    return categoryMatches(post);
  }));

  const renderCard = (post: CommunityAlert) => {
    const isMdrrmo = post.is_mdrrmo !== false;
    const sourceLabel = isMdrrmo ? 'MDRRMO Norzagaray' : `Barangay ${post.barangay_name || ''}`;
    const key = `${isMdrrmo ? 'mdrrmo' : 'barangay'}:${post.id}`;
    const pinned = isPinned(post);
    const canEdit = Boolean(canEditPost?.(post) && onEditPost);
    const canRemove = Boolean(canRemovePost?.(post) && onRemovePost);
    const canRepost = Boolean(canRepostPost?.(post) && onRepostPost);
    return <article className={`resident-alert-card ${normalizeCategory(post.category)}`} key={key}>
      <header><span className="resident-alert-icon">{normalizeCategory(post.category).startsWith('disaster_') ? <AlertTriangle size={17}/> : <Megaphone size={17}/>}</span><div><span>{categoryName(post.category)}</span><strong>{sourceLabel}</strong></div><button type="button" className={pinned ? 'resident-pin-button pinned' : 'resident-pin-button'} aria-label={pinned ? 'Unpin update' : 'Pin update'} onClick={() => togglePin(post)}>{pinned ? 'Pinned' : 'Pin'}</button></header>
      <p>{post.content || 'Official community update.'}</p>
      {!!post.media?.length && <div className="resident-alert-media">{post.media.map((media, index) => media.type === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(media.url) ? <video key={`${media.url}-${index}`} src={media.url} controls preload="metadata" /> : <a key={`${media.url}-${index}`} href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt={`${categoryName(post.category)} attachment`} loading="lazy"/></a>)}</div>}
      {!!post.links?.length && <div className="resident-alert-links">{post.links.map((href) => <a key={href} href={href} target="_blank" rel="noreferrer"><ExternalLink size={14}/>{href.replace(/^https?:\/\//, '')}</a>)}</div>}
      <footer><span>{post.author_name || sourceLabel}</span><time>{formatDate(post.created_at)}</time></footer>
      {(canEdit || canRemove || canRepost) && <div className="resident-alert-management-actions">
        {canEdit && <button type="button" onClick={() => onEditPost?.(post)}><Edit3 size={14}/> Edit</button>}
        {canRemove && <button type="button" className="danger" onClick={() => onRemovePost?.(post)}><Trash2 size={14}/> Remove</button>}
        {canRepost && <button type="button" onClick={() => onRepostPost?.(post)}><Share2 size={14}/> Repost to barangay board</button>}
      </div>}
    </article>;
  };
  const empty = (title: string, description: string) => <div className="resident-feed-empty"><Megaphone size={24}/><strong>{title}</strong><span>{description}</span><button type="button" onClick={onRefresh}>Refresh alerts</button></div>;
  const loadingView = <div className="resident-feed-empty"><RefreshCw className="workspace-spinning" size={22}/><strong>Loading alerts</strong><span>Getting the latest official community updates.</span></div>;

  return <>
    <section className="resident-feed-controls">
      {isMobile && <div className="resident-source-tabs" role="tablist" aria-label="Alert source">{(['all', 'barangay', 'mdrrmo', 'pinned'] as const).map((item) => <button type="button" role="tab" aria-selected={source === item} className={source === item ? 'selected' : ''} key={item} onClick={() => setSource(item)}>{item === 'all' ? 'All updates' : item === 'barangay' ? 'Barangay' : item === 'mdrrmo' ? 'MDRRMO' : 'Pinned'}</button>)}</div>}
      <label className="resident-select-label">Barangay posts<select value={selectedBarangay} onChange={(event) => setSelectedBarangay(event.target.value)}><option value="">All verified barangays</option>{barangays.map((name) => <option key={name} value={name}>{name}</option>)}</select><ChevronDown size={14}/></label>
      <div className="resident-category-tabs" aria-label="Filter by alert type">{alertCategories.map((item) => <button type="button" key={item.id} className={category === item.id ? 'selected' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
    </section>
    {error && <div className="resident-feedback error" role="alert">{error}<button type="button" onClick={onRefresh}>Try again</button></div>}
    {loading ? loadingView : <>
      {!isMobile && <div className="community-alert-desktop-columns">
        <section className="community-alert-column"><header><h2>Barangay posts</h2><span>{barangayPosts.length}</span></header>{barangayPosts.length ? <div className="community-alert-list">{barangayPosts.map(renderCard)}</div> : empty('No barangay posts', 'Verified barangay updates matching these filters will appear here.')}</section>
        <section className="community-alert-column"><header><h2>MDRRMO alerts</h2><span>{mdrrmoPosts.length}</span></header>{mdrrmoPosts.length ? <div className="community-alert-list">{mdrrmoPosts.map(renderCard)}</div> : empty('No MDRRMO alerts', 'Municipal updates matching these filters will appear here.')}</section>
      </div>}
      {isMobile && <div className="community-alert-mobile-view">{mobilePosts.length ? <div className="resident-alert-grid">{mobilePosts.map(renderCard)}</div> : empty('No alerts in this view', 'Try another source or category, or refresh the feed.')}</div>}
    </>}
  </>;
}
