import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { loadSnapshot, type LoadedSnapshot } from './data/loadSnapshot';
import { viewIdFromHash, views } from './views/registry';
import './views/shell.css';

function useHashViewId(): [string, (id: string) => void] {
  const [viewId, setViewId] = useState(() => viewIdFromHash(window.location.hash, views));

  useEffect(() => {
    const onHashChange = () => setViewId(viewIdFromHash(window.location.hash, views));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const select = useCallback((id: string) => {
    window.location.hash = id;
    setViewId(id);
  }, []);

  return [viewId, select];
}

export function App() {
  const [loaded, setLoaded] = useState<LoadedSnapshot | null>(null);
  const [viewId, selectView] = useHashViewId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    void loadSnapshot().then(setLoaded);
  }, []);

  const activeIndex = Math.max(
    0,
    views.findIndex((v) => v.id === viewId),
  );
  const active = views[activeIndex];

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (activeIndex + 1) % views.length;
        break;
      case 'ArrowLeft':
        next = (activeIndex - 1 + views.length) % views.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = views.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = views[next];
    if (!target) return;
    selectView(target.id);
    tabRefs.current[target.id]?.focus();
  };

  if (!active) return null;
  const ActiveView = active.component;

  return (
    <main className="page">
      <header className="header">
        <h1>Horizon Money</h1>
        {loaded && (
          <span className={`badge badge-${loaded.source}`}>
            {loaded.source === 'fixture' ? 'Demo data' : 'Your data'}
          </span>
        )}
      </header>
      <div className="tabs" role="tablist" aria-label="Views">
        {views.map((view) => (
          <button
            key={view.id}
            ref={(el) => {
              tabRefs.current[view.id] = el;
            }}
            type="button"
            role="tab"
            className="tab"
            id={`tab-${view.id}`}
            aria-selected={view.id === active.id}
            aria-controls={`panel-${view.id}`}
            tabIndex={view.id === active.id ? 0 : -1}
            onClick={() => selectView(view.id)}
            onKeyDown={onTabKeyDown}
          >
            {view.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`}>
        {loaded ? <ActiveView snapshot={loaded.snapshot} /> : <p role="status">Loading...</p>}
      </div>
    </main>
  );
}
