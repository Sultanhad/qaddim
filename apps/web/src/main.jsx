import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { ToastHost } from './toast.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary><ToastHost><App /></ToastHost></ErrorBoundary>
  </React.StrictMode>
);
