// Vercel Function: alle Anfragen unter /api werden an die Express-App weitergereicht.
import { createApp } from '../apps/api/src/app.js';

export default createApp();
