import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Keep the notification worker registered once the owner has turned it on.
if ('serviceWorker' in navigator && 'Notification' in window && Notification.permission === 'granted') {
  void navigator.serviceWorker.register('./sw.js');
}
