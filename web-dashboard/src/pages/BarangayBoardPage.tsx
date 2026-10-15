import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Plus, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { barangayAPI, broadcastAPI, reportAPI, socket } from '../lib/api';
import CommunityAlertsBoard, { type CommunityAlert } from '../components/CommunityAlertsBoard';

type MediaItem = { url: string; type: 'image' | 'video' };
type Post = CommunityAlert & { reposted_by?: string | null };
type Category = 'disaster_yellow' | 'disaster_orange' | 'disaster_red' | 'safety_advisory' | 'relief_assistance' | 'all_clear';
type PostForm = { category: Category; content: string; links: string; media: MediaItem[]; files: File[] };
const initialForm: PostForm = { category: 'safety_advisory', content: '', links: '', media: [], files: [] };
const categories: Array<{ value: Category; label: string }> = [
  { value: 'disaster_yellow', label: 'Disaster alert · Yellow' },
  { value: 'disaster_orange', label: 'Disaster alert · Orange' },
  { value: 'disaster_red', label: 'Disaster alert · Red' },
  { value: 'safety_advisory', label: 'Safety advisory' },
  { value: 'relief_assistance', label: 'Relief and assistance' },
  { value: 'all_clear', label: 'All-clear notice' },
];
const errorMessage = (error: any) => error?.response?.data?.error || 'The barangay board action could not be completed.';

function toFormData(form: PostForm) {
  const data = new FormData();
  data.append('category', form.category);
  data.append('content', form.content.trim());
  data.append('links', JSON.stringify(form.links.split('\n').map((link) => link.trim()).filter(Boolean)));
  data.append('existing_media', JSON.stringify(form.media));
  form.files.forEach((file, index) => {
    data.append('media', file);
    data.append(`media_type_${index}`, file.type.startsWith('video/') ? 'video' : 'image');
  });
  return data;
}

export default function BarangayBoardPage() {
  const { user } = useAuth();
  const canManage = user?.account_kind === 'barangay' && (user?.role === 'admin' || user?.role === 'staff');
  const [localPosts, setLocalPosts] = useState<Post[]>([]);
  const [barangays, setBarangays] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<PostForm>(initialForm);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [feedResult, barangayResult] = await Promise.allSettled([broadcastAPI.publicFeed(), reportAPI.verifiedBarangays()]);
      if (feedResult.status === 'fulfilled') setLocalPosts(Array.isArray(feedResult.value.data) ? feedResult.value.data : []);
      else setError((feedResult.reason as any)?.response?.data?.error || 'Community alerts could not be loaded.');
      if (barangayResult.status === 'fulfilled') {
        const list = Array.isArray(barangayResult.value.data) ? barangayResult.value.data : [];
        setBarangays(list.filter((item: any) => item.is_verified !== false).map((item: any) => String(item.name || '')).filter(Boolean));
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    socket.on('broadcast:new', load);
    socket.on('broadcast:removed', load);
    socket.on('broadcast:changed', load);
    return () => {
      socket.off('broadcast:new', load);
      socket.off('broadcast:removed', load);
      socket.off('broadcast:changed', load);
    };
  }, [load]);

  const resetForm = useCallback(() => { setEditingId(null); setForm(initialForm); setIsFormOpen(false); }, []);
  useEffect(() => {
    if (!isFormOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isFormOpen]);
  const editPost = (post: Post) => {
    setEditingId(post.id);
    setForm({ category: (categories.some((item) => item.value === post.category) ? post.category : 'safety_advisory') as Category, content: post.content || '', links: (post.links || []).join('\n'), media: (post.media || []).map((item) => ({ url: item.url, type: item.type === 'video' ? 'video' : 'image' })), files: [] });
    setIsFormOpen(true);
  };

  const submitPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form.content.trim().length < 10) { toast.error('Write at least 10 characters for the post.'); return; }
    setSaving(true);
    try {
      const body = toFormData(form);
      if (editingId) await barangayAPI.updateBarangayBroadcast(editingId, body);
      else await barangayAPI.createBarangayBroadcast(body);
      toast.success(editingId ? 'Barangay post updated.' : 'Barangay post published.');
      resetForm(); await load();
    } catch (saveError: any) { toast.error(errorMessage(saveError)); }
    finally { setSaving(false); }
  };

  const repost = async (post: Post) => {
    try { await barangayAPI.repostMdrrmoBroadcast(post.id); toast.success('MDRRMO alert added to your barangay board.'); await load(); }
    catch (actionError: any) { toast.error(errorMessage(actionError)); }
  };
  const togglePin = async (post: Post) => {
    try { await barangayAPI.setBarangayBroadcastPinned(post.id, !post.is_pinned); toast.success(post.is_pinned ? 'Post unpinned.' : 'Post pinned.'); await load(); }
    catch (actionError: any) { toast.error(errorMessage(actionError)); }
  };
  const removePost = async (post: Post) => {
    if (!window.confirm('Remove this post from the barangay board?')) return;
    try { await barangayAPI.deleteBarangayBroadcast(post.id); toast.success('Post removed from the barangay board.'); await load(); }
    catch (actionError: any) { toast.error(errorMessage(actionError)); }
  };

  const ownsBarangayPost = (post: CommunityAlert) => user?.account_kind === 'barangay' && Boolean(user.barangay_id || user.barangay_name)
    && (post.barangay_id ? post.barangay_id === user.barangay_id : String(post.barangay_name || '').toLowerCase().replace(/^barangay\s+/i, '') === String(user.barangay_name || '').toLowerCase().replace(/^barangay\s+/i, ''));

  return (
    <div className="barangay-console-page">
      <header className="barangay-console-header"><div><span className="workspace-eyebrow">COMMUNITY INFORMATION{user?.barangay_name ? ` · ${user.barangay_name}` : ''}</span><h1>Community alerts</h1><p>Official MDRRMO updates and posts from your selected barangay.</p></div><div className="barangay-console-header-actions">{canManage && !isFormOpen && <button className="workspace-primary-action" type="button" onClick={() => { setEditingId(null); setForm(initialForm); setIsFormOpen(true); }} aria-haspopup="dialog"><Plus size={16} /> Create Post</button>}<button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh</button></div></header>

      {canManage && isFormOpen && <div className="barangay-console-modal-backdrop" role="presentation" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!saving) resetForm(); }
        if (event.key === 'Tab') {
          const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) resetForm(); }}>
        <section className="barangay-console-panel barangay-console-form-modal" role="dialog" aria-modal="true" aria-labelledby="barangay-post-form-title">
        <header><div><h2 id="barangay-post-form-title">{editingId ? 'Edit barangay post' : 'Publish a barangay post'}</h2><p>Posts on this board are published to the barangay community feed.</p></div><button autoFocus className="workspace-secondary-action" type="button" onClick={resetForm} disabled={saving}><X size={15} /> Cancel</button></header>
        <form className="barangay-console-post-form" onSubmit={(event) => void submitPost(event)}>
          <label>Post category<select value={form.category} onChange={(event) => setForm((value) => ({ ...value, category: event.target.value as Category }))}>{categories.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
          <label>Announcement<textarea required minLength={10} rows={4} value={form.content} onChange={(event) => setForm((value) => ({ ...value, content: event.target.value }))} placeholder="Share an official safety advisory or community update…" /></label>
          <label>Reference links <span>(one URL per line)</span><textarea rows={2} value={form.links} onChange={(event) => setForm((value) => ({ ...value, links: event.target.value }))} placeholder="https://…" /></label>
          {form.media.length > 0 && <div className="barangay-post-edit-media"><span>Existing media</span>{form.media.map((item, index) => <div key={`${item.url}-${index}`}>{item.type === 'image' ? <img src={item.url} alt="Attached post media" /> : <video src={item.url} controls />}<button type="button" aria-label="Remove attached media" onClick={() => setForm((value) => ({ ...value, media: value.media.filter((_, mediaIndex) => mediaIndex !== index) }))}><X size={14} /></button></div>)}</div>}
          <label>Attach images or video<input type="file" multiple accept="image/*,video/*" onChange={(event) => setForm((value) => ({ ...value, files: [...value.files, ...Array.from(event.target.files || [])] }))} /></label>
          {form.files.length > 0 && <div className="barangay-post-file-list">{form.files.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setForm((value) => ({ ...value, files: value.files.filter((_, fileIndex) => fileIndex !== index) }))}><X size={13} /></button></span>)}</div>}
          <div className="barangay-console-form-actions"><button className="btn btn-primary" disabled={saving}>{saving ? 'Publishing…' : editingId ? <><Check size={16} /> Save post</> : <><Plus size={16} /> Publish post</>}</button></div>
        </form>
        </section>
      </div>}

      <CommunityAlertsBoard
        posts={localPosts}
        barangays={barangays}
        initialBarangay={user?.barangay_name || ''}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        canPinPost={(post) => canManage && ownsBarangayPost(post)}
        onToggleServerPin={(post) => void togglePin(post)}
        canEditPost={(post) => canManage && ownsBarangayPost(post) && !post.is_from_mdrrmo}
        onEditPost={(post) => editPost(post)}
        canRemovePost={(post) => canManage && ownsBarangayPost(post)}
        onRemovePost={(post) => void removePost(post)}
        canRepostPost={(post) => canManage && post.is_mdrrmo === true}
        onRepostPost={(post) => void repost(post)}
      />
    </div>
  );
}
