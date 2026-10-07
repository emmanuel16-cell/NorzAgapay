import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { config } from '../config';

let messaging: Messaging | null = null;
let setupChecked = false;

/** Return the shared Firebase Admin Messaging client when credentials exist. */
export function getFirebaseMessagingClient(): Messaging | null {
  if (messaging) return messaging;
  if (setupChecked) return null;
  setupChecked = true;

  try {
    if (getApps().length === 0) {
      if (config.firebaseServiceAccountJson) {
        const serviceAccount = JSON.parse(config.firebaseServiceAccountJson);
        initializeApp({
          credential: cert(serviceAccount),
          projectId: config.firebaseProjectId || serviceAccount.project_id,
        });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        initializeApp({
          credential: applicationDefault(),
          ...(config.firebaseProjectId ? { projectId: config.firebaseProjectId } : {}),
        });
      } else {
        return null;
      }
    }
    messaging = getMessaging();
    return messaging;
  } catch (error) {
    console.error('Firebase push notification setup failed:', error);
    return null;
  }
}
