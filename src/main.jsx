import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Home from './components/Home.jsx';
import '@fontsource-variable/space-grotesk';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
window.CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium`;

// Two views share one page: the home page sits on top of the map, which loads underneath so it is ready when opened.
// The address keeps the choice: #/ is home, #/map is the map.
const isMap = () => window.location.hash.startsWith('#/map');
function Root() {
  const [view, setView] = React.useState(isMap() ? 'map' : 'home');
  React.useEffect(() => { const h = () => setView(isMap() ? 'map' : 'home'); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  const enter = (caseKey) => {
    if (caseKey) { window.__sarPendingCase = caseKey; window.dispatchEvent(new CustomEvent('sar-open-case', { detail: { key: caseKey } })); }
    window.location.hash = '#/map';
  };
  return (
    <>
      <div className="app-shell" inert={view === 'home'} aria-hidden={view === 'home'}><App /></div>
      {view === 'home' && <Home onEnter={enter} />}
    </>
  );
}
createRoot(document.getElementById('root')).render(<Root />);
