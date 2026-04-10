import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'

let app: FirebaseApp | null = null
let authInstance: Auth | null = null

if (!DEV_BYPASS && import.meta.env.VITE_FIREBASE_API_KEY) {
  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  }
  app = initializeApp(firebaseConfig)
  authInstance = getAuth(app)
}

export const auth = authInstance as Auth
export const googleProvider = new GoogleAuthProvider()
