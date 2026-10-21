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
    const notifiedReportCycles = new Set<string>();

    // Join room for real-time updates
    socket.emit('join:role', user.role);

    const openIncidentInCommandCenter = (reportId: string) => {
      navigate(`/command-center?report_id=${encodeURIComponent(reportId)}`);
    };

    // Helper to show custom notification
    const showIncidentNotification = (reportId: string, title: string, severity?: string, resubmissionCount = 0) => {
      const reportTitle = title?.trim() || 'Incident report';
      const isResubmission = resubmissionCount > 0;
      const isCritical = /critical|life.?threatening/i.test(title) ||
        ['critical', 'life-threatening', 'life_threatening'].includes(String(severity || '').toLowerCase());
      playNotificationSound(isCritical ? 'criticalIncident' : 'incident');
      toast((t) => (
        <div 
          onClick={() => {
            toast.dismiss(t.id);
            openIncidentInCommandCenter(reportId);
          }}
          style={{ width: '100%', cursor: 'pointer', padding: '10px' }}
        >
          <div style={{ fontWeight: 'bold', color: 'white' }}>
            {isCritical ? '🚨 URGENT: ' : isResubmission ? 'Report resubmitted: ' : 'New incident report: '}{reportTitle}
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)' }}>
            {isCritical ? 'Critical incident reported. Click to review.' : isResubmission ? 'The reporter corrected this incident and sent it back for review.' : 'A new incident report was submitted. Click to review.'}
          </div>
        </div>
      ), {
        duration: 60000,
        className: 'notification-emergency',
        position: 'top-right',
      });
    };

    // Listen for new incident reports
    const onMdrrmoNewReport = (report: any) => {
      if (['dispatcher', 'master_admin'].includes(user.role) && isVisibleToMdrrmo(report)) {
        const reportId = String(report?.id || '').trim();
        if (!reportId) return;
        const cycle = Math.max(0, Number(report?.resubmission_count) || 0);
        const key = `${reportId}:${cycle}`;
        if (notifiedReportCycles.has(key)) return;
        notifiedReportCycles.add(key);
        showIncidentNotification(reportId, report.title, report.severity, cycle);
      }
    };
    socket.on('incident_report:new', onMdrrmoNewReport);

    const onBarangayReportAssigned = (report: any) => {
      if (user.account_kind !== 'barangay' || user.role !== 'dispatcher') return;
      const reportId = String(report?.id || report?.report_id || '').trim();
      if (!reportId) return;
      const reportTitle = String(report?.title || '').trim() || 'Emergency incident';
      playNotificationSound('incident');
      toast((t) => (
        <div
          onClick={() => {
            toast.dismiss(t.id);
            openIncidentInCommandCenter(reportId);
          }}
          style={{ width: '100%', cursor: 'pointer', padding: '10px' }}
        >
          <div style={{ fontWeight: 'bold', color: 'white' }}>
            Incident report assigned: {reportTitle}
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)' }}>
            MDRRMO assigned a report to your barangay. Click to select it on the command center map.
          </div>
        </div>
      ), {
        duration: 60000,
        className: 'notification-emergency',
        position: 'top-right',
      });
    };
    socket.on('barangay:report_assigned', onBarangayReportAssigned);

    socket.on('resource:request', (request: any) => {
      if (!['dispatcher', 'master_admin'].includes(user.role)) return;
      playNotificationSound('assistance');
      toast((t) => (
        <div
          onClick={() => {
            toast.dismiss(t.id);
            navigate(request.incident_id
              ? `/command-center?report_id=${encodeURIComponent(request.incident_id)}&responder_tab=assistance`
              : '/requests');
          }}
          style={{ width: '100%', cursor: 'pointer', padding: '10px' }}
        >
          <div style={{ fontWeight: 'bold', color: 'white' }}>
            Assistance requested by {request.requested_by_user?.full_name || 'Responder'}
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)' }}>
            Click to open the incident map and assistance request.
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
        responding: ['Response underway', `${report?.responderName || 'The assigned response team'} from ${report?.barangayName || 'the response unit'} is responding to the incident.`],
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
            openIncidentInCommandCenter(reportId);
          }}
          style={{ width: '100%', cursor: 'pointer', padding: '10px' }}
        >
          <div style={{ fontWeight: 'bold', color: 'white' }}>{title}</div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)' }}>{detail}</div>
        </div>
      ), { duration: 30000, position: 'top-right' });
    };

    const seenProgressNotifications = new Set<string>();
    const seenFollowUpNotifications = new Set<string>();
    const onReportUpdated = (report: any) => {
      if (!report || typeof report !== 'object') return;
      if (report.reporter_follow_up && typeof report.reporter_follow_up === 'object') {
        onReporterFollowUp(report.reporter_follow_up);
      }
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

    const onReporterFollowUp = (payload: any) => {
      const isBarangayDispatcher = user.account_kind === 'barangay' && user.role === 'dispatcher';
      const isCentralDispatcher = user.account_kind !== 'barangay' && ['dispatcher', 'admin', 'master_admin'].includes(user.role);
      if (!isBarangayDispatcher && !isCentralDispatcher) return;
      const reportId = String(payload?.reportId || '').trim();
      if (!reportId) return;
      const notificationId = String(payload?.followUpId || `${reportId}:${payload?.createdAt || ''}`);
      if (seenFollowUpNotifications.has(notificationId)) return;
      seenFollowUpNotifications.add(notificationId);
      if (seenFollowUpNotifications.size > 300) {
        seenFollowUpNotifications.delete(seenFollowUpNotifications.values().next().value!);
      }
      const title = String(payload?.title || '').trim() || 'Emergency incident';
      const attachmentCount = Number(payload?.attachmentCount) || 0;
      const detail = attachmentCount > 0
        ? `A new reporter update includes ${attachmentCount} photo or video attachment${attachmentCount === 1 ? '' : 's'}. Click to review the incident.`
        : 'A new reporter follow-up update was submitted without photo or video attachments. Click to review the incident.';
      playNotificationSound('criticalIncident');
      toast((t) => (
        <div
          onClick={() => {
            toast.dismiss(t.id);
            openIncidentInCommandCenter(reportId);
          }}
          style={{ width: '100%', cursor: 'pointer', padding: '10px' }}
        >
          <div style={{ fontWeight: 'bold', color: 'white' }}>🚨 New reporter follow-up update: {title}</div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)' }}>
            {detail}
          </div>
        </div>
      ), { duration: 60000, className: 'notification-emergency', position: 'top-right' });
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
            if (payload?.reportId) openIncidentInCommandCenter(String(payload.reportId));
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
    socket.on('incident_report:follow_up', onReporterFollowUp);
    socket.on('barangay:escalated', onEscalated);
    socket.on('barangay:responding', onBarangayResponding);
    socket.on('barangay:incident_closed', onIncidentClosed);

    // Mock simulate function for testing
    (window as any).simulateNewReport = (reportId: string, title: string, severity?: string) => {
      showIncidentNotification(reportId, title, severity);
    };

    return () => {
      socket.off('incident_report:new', onMdrrmoNewReport);
      socket.off('barangay:report_assigned', onBarangayReportAssigned);
      socket.off('resource:request');
      socket.off('incident_report:updated', onReportUpdated);
      socket.off('incident_report:follow_up', onReporterFollowUp);
      socket.off('barangay:escalated', onEscalated);
      socket.off('barangay:responding', onBarangayResponding);
      socket.off('barangay:incident_closed', onIncidentClosed);
      delete (window as any).simulateNewReport;
    };
  }, [navigate, user]);

  return null;
}
