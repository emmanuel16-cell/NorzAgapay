/**
 * Disposable, client-only responder preview data.
 * Remove this file and its usage in ResponderWorkspacePage to remove the demo.
 */
export function createDemoResponderReport() {
  const dispatchedAt = new Date().toISOString();

  return {
    id: 'demo-responder-preview',
    title: 'Demo: Medical assistance requested',
    description: 'Sample-only assignment to preview the responder workspace. This is not a live emergency report.',
    incident_type: 'medical_emergency',
    severity: 'high',
    latitude: 14.9055,
    longitude: 121.045,
    created_at: dispatchedAt,
    response_status: 'responding',
    barangay_response_status: 'responding',
    assignment_status: 'active',
    is_central_assignment: true,
    barangay_dispatched_at: dispatchedAt,
    is_demo: true as const,
  };
}
