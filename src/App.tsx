import { useEffect, useMemo, useState } from "react";
import { configureApiKeyStorage, connectWithApiKey, disconnectBuffer, getDashboardStats, getOrganizations, getSavedOrganizationId, isBufferConnected, saveOrganizationId, type DashboardStats } from "./buffer";

type StatsResponse = DashboardStats;

const number = new Intl.NumberFormat("en-US");

type ExposureToken = { denomination: 10 | 100 | 1000; multiplier: number; x: number; y: number; rotation: number; size: number };

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function exposureTokens(total: number, seed: number): ExposureToken[] {
  const random = seededRandom(seed + total);
  const roundedTotal = Math.floor(Math.max(total, 0) / 10) * 10;
  let thousands = Math.floor(roundedTotal / 1000);
  let remainder = roundedTotal % 1000;
  let hundreds = Math.floor(remainder / 100);
  let tens = Math.floor((remainder % 100) / 10);

  // Break a few large units into smaller ones so every field has a lively mix.
  const splitThousands = Math.min(thousands, Math.max(0, Math.round(thousands * .16)));
  thousands -= splitThousands;
  hundreds += splitThousands * 10;
  const splitHundreds = Math.min(hundreds, Math.max(0, Math.round(hundreds * .12)));
  hundreds -= splitHundreds;
  tens += splitHundreds * 10;

  const tokens: Array<{ denomination: 10 | 100 | 1000; multiplier: number }> = [];
  const addCompressed = (denomination: 10 | 100 | 1000, count: number, limit: number) => {
    if (!count) return;
    const multiplier = Math.max(1, Math.ceil(count / limit));
    for (let left = count; left > 0; left -= multiplier) tokens.push({ denomination, multiplier: Math.min(multiplier, left) });
  };
  addCompressed(1000, thousands, 54);
  addCompressed(100, hundreds, 42);
  addCompressed(10, tens, 34);

  return tokens
    .sort(() => random() - .5)
    .map(token => ({ ...token, x: 3 + random() * 91, y: 4 + random() * 88, rotation: -18 + random() * 36, size: .78 + random() * .55 }));
}

function ExposureImage({ denomination }: { denomination: 10 | 100 | 1000 }) {
  return <span className="exposure-emoji" aria-hidden="true">{denomination === 10 ? "💯" : denomination === 100 ? "🔥" : "🚀"}</span>;
}

function ExposureMosaic({ exposure, seed, animal }: { exposure: number; seed: number; animal?: "pug" | "cat" | "sticker" }) {
  const tokens = useMemo(() => exposureTokens(exposure, seed), [exposure, seed]);
  const displayTokens = useMemo(() => animal === "pug" || animal === "cat" ? tokens.map(token => ({ ...token, x: 18 + token.x / 94 * 64, y: 46 + token.y / 92 * 48, size: 1.55 })) : tokens.map(token => ({ ...token, size: animal === "sticker" ? 1.25 : 1.55 })), [tokens, animal]);
  return <div className="exposure-mosaic" aria-label={`${number.format(exposure)} exposure represented by scattered image tokens`}>
    {displayTokens.map((token, index) => <div className={`exposure-token token-${token.denomination}`} key={`${seed}-${token.denomination}-${index}`} style={{ left: `${token.x}%`, top: `${token.y}%`, transform: `translate(-50%,-50%) rotate(${token.rotation}deg) scale(${token.size})`, zIndex: Math.round(token.y), "--enter-delay": `${displayTokens.length <= 1 ? 0 : index / (displayTokens.length - 1) * 1.2}s` } as React.CSSProperties}>
      <span className="token-art">{animal ? <img className={`animal-token-image ${animal}-tier-image`} src={`/images/${animal}-${token.denomination === 10 ? 1 : token.denomination === 100 ? 2 : 3}.png`} alt=""/> : <ExposureImage denomination={token.denomination}/>}<b>{number.format(token.denomination)}</b>{token.multiplier > 1 && <em>×{token.multiplier}</em>}</span>
    </div>)}
  </div>;
}

export function App() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [displayDays, setDisplayDays] = useState(30);
  const [visualization, setVisualization] = useState(() => {
    const saved = Number(localStorage.getItem("reachForTheStarsVisualization"));
    return Number.isInteger(saved) && saved >= 0 && saved < 3 ? saved : 0;
  });

  async function loadAccount(selectedDays = days, organizationId = selectedOrganizationId) {
    setLoading(true);
    setError(null);
    try {
      setData(await getDashboardStats(selectedDays, organizationId));
      setDisplayDays(selectedDays);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Could not load your Buffer account.";
      setError(message);
      if (message.includes("API key is invalid") || message.includes("Paste your Buffer API key")) setConnected(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        await configureApiKeyStorage();
        const hasConnection = await isBufferConnected();
        setConnected(hasConnection);
        if (hasConnection) {
          const availableOrganizations = await getOrganizations();
          setOrganizations(availableOrganizations);
          const savedOrganizationId = await getSavedOrganizationId();
          const organizationId = availableOrganizations.some(item => item.id === savedOrganizationId) ? savedOrganizationId : availableOrganizations[0]?.id ?? null;
          setSelectedOrganizationId(organizationId);
          if (organizationId) await saveOrganizationId(organizationId);
          await loadAccount(days, organizationId);
        }
        else setLoading(false);
      } catch (initialError) {
        setError(initialError instanceof Error ? initialError.message : "Could not check your Buffer connection.");
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (connected) void loadAccount(days);
    else setDisplayDays(days);
  }, [days]);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      await connectWithApiKey(apiKey);
      setConnected(true);
      setApiKey("");
      const availableOrganizations = await getOrganizations();
      setOrganizations(availableOrganizations);
      const organizationId = availableOrganizations[0]?.id ?? null;
      setSelectedOrganizationId(organizationId);
      if (organizationId) await saveOrganizationId(organizationId);
      await loadAccount(days, organizationId);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not validate this Buffer API key.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await disconnectBuffer();
    setConnected(false);
    setData(null);
    setOrganizations([]);
    setSelectedOrganizationId(null);
    setError(null);
  }

  async function handleOrganizationChange(organizationId: string) {
    setSelectedOrganizationId(organizationId);
    await saveOrganizationId(organizationId);
    await loadAccount(days, organizationId);
  }

  const stats = data?.stats ?? { posts: null, likes: null, comments: null, exposure: null, engagementRate: null, clicks: null };
  const visualizations = [
    { title: "Sticker exposure", description: "Exposure represented by sticker tiers." },
    { title: "Pug exposure", description: "Exposure represented by pugs." },
    { title: "Cat exposure", description: "Exposure represented by cats." }
  ];
  const chooseVisualization = (index: number) => {
    const next = (index + visualizations.length) % visualizations.length;
    localStorage.setItem("reachForTheStarsVisualization", String(next));
    setVisualization(next);
  };
  const moveVisualization = (direction: number) => chooseVisualization(visualization + direction);
  return <main><div className="stack">
    <div className="stats-stack"><section className="card" aria-live="polite">
      <div className="heading">
        <div><div className="dashboard-filters"><select id="timeframe" aria-label="Timeframe" value={days} onChange={event => setDays(Number(event.target.value))}>
          <option value={7}>Past 7 days</option>
          <option value={30}>Past 30 days</option>
          <option value={90}>Past 90 days (paid plans)</option>
        </select>{connected && organizations.length > 1 && <select id="organization" aria-label="Buffer organization" value={selectedOrganizationId ?? ""} onChange={event => void handleOrganizationChange(event.target.value)}>{organizations.map(organization => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select>}</div><h1>{data?.organization.name ?? "Buffer stats"}</h1></div>
        {connected ? <button onClick={() => void loadAccount()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button> : null}
      </div>
      {error && <div className="error"><strong>Buffer needs attention</strong><span>{error}</span></div>}
      {!connected && <div className="connect-panel"><strong>Connect your Buffer analytics</strong><span>Create a read-only personal API key with Insights access, then paste it below. It stays in this extension and is only sent to Buffer.</span><a href="https://publish.buffer.com/settings/api" target="_blank" rel="noreferrer">Create a Buffer API key ↗</a><label htmlFor="buffer-api-key">Buffer API key</label><input id="buffer-api-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Paste API key" autoComplete="off" spellCheck={false} onKeyDown={event => { if (event.key === "Enter") void handleConnect(); }}/><button onClick={() => void handleConnect()} disabled={connecting || !apiKey.trim()}>{connecting ? "Checking key…" : "Save and connect"}</button></div>}
      <div className="grid">
        <div className="metric exposure-metric"><span>{visualization === 0 ? <>Total people reached*</> : visualization === 1 ? <>Total <s>pugs</s> people reached*</> : <>Total <s>cats</s> people reached*</>}</span><strong>{stats.exposure === null ? "—" : number.format(stats.exposure)}</strong></div>
        <div className="metric"><span>Posts</span><strong>{stats.posts === null ? "—" : number.format(stats.posts)}</strong></div>
        <div className="metric"><span>Engagement rate</span><strong>{stats.engagementRate === null ? "—" : stats.engagementRate.toFixed(1) + "%"}</strong></div>
      </div>
      <p className="exposure-note">*Exposure = reach + views + impressions returned by Buffer. These measures can overlap.</p>
      <footer>{data?.metricsUpdatedAt ? `Updated ${new Date(data.metricsUpdatedAt).toLocaleString()}` : connected ? "Connected · Waiting for reported metrics" : "Add a Buffer API key to begin"}{connected && <button className="disconnect-button" onClick={() => void handleDisconnect()}>Replace key</button>}</footer>
    </section>
    <a className="post-button" href="https://publish.buffer.com/" target="_blank" rel="noreferrer">Create a post in Buffer <span aria-hidden="true">↗</span></a></div>
    <section className="viz-carousel" aria-label="Visualizations">
      <div className="viz-frame">
        <div className={"viz-placeholder viz-" + (visualization + 1)}>{visualization === 0 && <ExposureMosaic exposure={stats.exposure ?? 0} seed={displayDays} animal="sticker"/>}{visualization === 1 && <ExposureMosaic exposure={stats.exposure ?? 0} seed={displayDays + 101} animal="pug"/>}{visualization === 2 && <ExposureMosaic exposure={stats.exposure ?? 0} seed={displayDays + 202} animal="cat"/>}</div>
        <button className="viz-arrow viz-arrow-left" onClick={() => moveVisualization(-1)} aria-label="Previous visualization">←</button>
        <button className="viz-arrow viz-arrow-right" onClick={() => moveVisualization(1)} aria-label="Next visualization">→</button>
      </div>
      <div className="viz-footer"><span>{visualization + 1} / {visualizations.length}</span><div className="viz-dots">{visualizations.map((item, index) => <button key={item.title} className={index === visualization ? "active" : ""} onClick={() => chooseVisualization(index)} aria-label={"Show " + item.title} />)}</div></div>
    </section>
    <a className="privacy-link" href="https://www.iubenda.com/privacy-policy/729949" target="_blank" rel="noreferrer">Privacy</a>
  </div></main>;
}
