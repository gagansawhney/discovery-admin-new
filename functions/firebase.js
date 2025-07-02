const admin = require('firebase-admin');

// Initialize the default app for the current project (functions and storage)
admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Initialize a separate app for the external database project
const externalApp = admin.initializeApp({
  projectId: 'discovery-1e94e',
}, 'externalApp'); // Give it a unique name

const externalDb = externalApp.firestore();

module.exports = { db, bucket, externalDb };