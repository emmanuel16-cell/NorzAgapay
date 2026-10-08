import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { socket } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { isVisibleToMdrrmo } from '../lib/mdrrmoReportVisibility';
import { playNotificationSound } from '../lib/notificationSound';

export default function NotificationManager() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    // Join room for real-time updates
    socket.emit('join:role', user.role);

    // Helper to show custom notification
    const showIncidentNotification = (reportId: string, title: string, severity?: string) => {
      const isCritical = /critical|life.?threatening/i.test(title) ||
        ['critical', 'life-threatening', 'life_threatening'].includes(String(severity || '').toLowerCase());
      playNotificationSound(isCritical ? 'criticalIncident' : 'incident');
      toast((t) => (
        <div 
          onClick={() => {
            toast.dismiss(t.id);
            navigate(`/reports?id=${reportId}`);
          }}
          style={{ width: '100%', cursor: 'pointer', padding: '10px' }}
        >
          <div style={{ fontWeight: 'bold', color: 'white' }}>
            🚨 URGENT: {title}
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)' }}>New report from Resident. Click to view.</div>
        </div>
      ), {
        duration: 60000,
        className: 'notification-emergency',
        position: 'top-right',
      });
    };

    // Listen for new incident reports
    socket.on('incident_report:new', (report: any) => {
      if (['dispatcher', 'master_admin'].includes(user.role) && isVisibleToMdrrmo(report)) {
        showIncidentNotification(report.id, report.title, report.severity);
      }
    });

    socket.on('resource:request', (request: any) => {
      if (!['dispatcher', 'master_admin'].includes(user.role)) return;
      playNotificationSound('assistance');
      toast((t) => (
        <div
          onClick={() => {
            toast.dismiss(t.id);
            navigate(request.incident_id ? `/requests?incident_id=${encodeURIComponent(request.incident_id)}` : '/requests');
          }}
          style={{ width: '100%', cursor: 'pointer', padding: '10px' }}
        >
          <div style={{ fontWeight: 'bold', color: 'white' }}>Assistance requested</div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)' }}>
            {request.requested_by_user?.full_name || 'Responder'} submitted a {request.request_type || 'resource'} request.
          </div>
        </div>
      ), { duration: 30000, position: 'top-right' });
    });

    const showReportProgressNotification = (
      report: any,
      stage: 'review' | 'assigned' | 'responding' | 'arrival' | 'resolved',
    ) => {
      if (!['dispatcher', 'master_admin'].includes(user.role)) return;
      const reportId = String(report?.id || report?.report_id || '').trim();
      if (!reportId) return;
      const notificationKey = `${reportId}:${stage}`;
      if (seenProgressNotifications.has(notificationKey)) return;
      seenProgressNotifications.add(notificationKey);
      if (seenProgressNotifications.size > 500) {
        seenProgressNotifications.delete(seenProgressNotifications.values().next().value!);
      }
      const messages = {
        review: ['Report reviewed', 'A dispatcher has reviewed an incident report.'],
        assigned: ['Responder assigned', 'A responder has been assigned to an incident.'],
        responding: ['Responder en route', `${report?.responderName || 'A responder'} from ${report?.barangayName || 'a response unit'} accepted the dispatch and is heading to the incident.`],
        arrival: ['Responder arrived', 'A responder arrived at the incident location.'],
        resolved: ['Incident resolved', 'An incident response has been marked resolved.'],
      } as const;
      const sounds = { review: 'review', assigned: 'assigned', responding: 'responding', arrival: 'arrival', resolved: 'resolved' } as const;
      const [title, detail] = messages[stage];
      playNotificationSound(sounds[stage]);
      toast((t) => (
        <div
          onClick={() => {
            toast.dismiss(t.id);
            navigate(`/reports?id=${encodeURIComponent(reportId)}`);
          }}
          style={{ width: '100%', cursor: 'pointer', padding: '10px' }}
        >
          <div style={{ fontWeight: 'bold', color: 'white' }}>{title}</div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)' }}>{detail}</div>
        </div>
      ), { duration: 30000, position: 'top-right' });
    };

    const seenProgressNotifications = new Set<string>();
    const onReportUpdated = (report: any) => {
      if (!report || typeof report !== 'object') return;
      const isResolved = Boolean(report.resolved_at || report.mdrrmo_resolved_at) ||
        ['resolved', 'closed'].includes(String(report.mdrrmo_response_status || report.response_status || '').toLowerCase());
      const isArrived = Boolean(report.arrived_at || report.mdrrmo_arrived_at);
      const isResponding = Boolean(report.accepted_at || report.mdrrmo_accepted_at) ||
        ['responding', 'accepted'].includes(String(report.mdrrmo_response_status || report.response_status || '').toLowerCase());
      const isDispatched = Boolean(report.dispatched_at || report.mdrrmo_dispatched_at);
      const isReviewed = Boolean(report.dispatcher_reviewed_at);
      if (isResolved) showReportProgressNotification(report, 'resolved');
      else if (isArrived) showReportProgressNotification(report, 'arrival');
      else if (isResponding) showReportProgressNotification(report, 'responding');
      else if (isDispatched) showReportProgressNotification(report, 'assigned');
      else if (isReviewed) showReportProgressNotification(report, 'review');
    };

    const onEscalated = (payload: any) => {
      if (!['dispatcher', 'master_admin'].includes(user.role)) return;
      const notificationKey = `escalated:${String(payload?.reportId || '')}`;
      if (seenProgressNotifications.has(notificationKey)) return;
      seenProgressNotifications.add(notificationKey);
      playNotificationSound('escalation');
      toast((t) => (
        <div
          onClick={() => {
            toast.dismiss(t.id);
            if (payload?.reportId) navigate(`/reports?id=${encodeURIComponent(String(payload.reportId))}`);
          }}
          style={{ width: '100%', cursor: 'pointer', padding: '10px' }}
        >
          <div style={{ fontWeight: 'bold', color: 'white' }}>Report escalated to MDRRMO</div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)' }}>
            {payload?.barangayName || 'A barangay'} escalated an incident{payload?.incidentType ? `: ${payload.incidentType}` : ''}.
          </div>
        </div>
      ), { duration: 30000, position: 'top-right' });
    };

    const onBarangayResponding = (payload: any) => {
      if (!['dispatcher', 'master_admin'].includes(user.role)) return;
      showReportProgressNotification({
        id: payload?.reportId,
        responderName: payload?.responderName,
        barangayName: payload?.barangayName,
      }, 'responding');
    };

    const onIncidentClosed = (payload: any) => {
      if (!['dispatcher', 'master_admin'].includes(user.role)) return;
      showReportProgressNotification({ id: payload?.reportId }, 'resolved');
    };

    socket.on('incident_report:updated', onReportUpdated);
    socket.on('barangay:escalated', onEscalated);
    socket.on('barangay:responding', onBarangayResponding);
    socket.on('barangay:incident_closed', onIncidentClosed);

    // Mock simulate function for testing
    (window as any).simulateNewReport = (reportId: string, title: string, severity?: string) => {
      showIncidentNotification(reportId, title, severity);
    };

    return () => {
      socket.off('incident_report:new');
      socket.off('resource:request');
      socket.off('incident_report:updated', onReportUpdated);
      socket.off('barangay:escalated', onEscalated);
      socket.off('barangay:responding', onBarangayResponding);
      socket.off('barangay:incident_closed', onIncidentClosed);
      delete (window as any).simulateNewReport;
    };
  }, [navigate, user]);

  return null;
}
