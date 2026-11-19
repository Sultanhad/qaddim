import React from 'react';
import { createRoot } from 'react-dom/client';
// The type, served from this site: IBM Plex Sans Arabic draws Arabic and Latin as one family,
// and a phone without a good Arabic face no longer falls back to whatever it has. Self-hosted,
// so a visitor's address goes to no font service.
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles.css';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { ToastHost } from './toast.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary><ToastHost><App /></ToastHost></ErrorBoundary>
  </React.StrictMode>
);
