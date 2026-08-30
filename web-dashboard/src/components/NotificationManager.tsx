import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { socket } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export default function NotificationManager() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    // Join room for real-time updates
    socket.emit('join:role', user.role);

    // Helper to show custom notification
    const showIncidentNotification = (reportId: string, title: string) => {
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
      if (report.type === 'emergency') {
        showIncidentNotification(report.id, report.title);
      }
    });

    // Mock simulate function for testing
    (window as any).simulateNewReport = (reportId: string, title: string) => {
      showIncidentNotification(reportId, title);
    };

    return () => {
      socket.off('incident_report:new');
      delete (window as any).simulateNewReport;
    };
  }, [navigate, user]);

  return null;
}
