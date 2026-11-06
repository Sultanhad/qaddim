import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>
);
