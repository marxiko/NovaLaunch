import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Launch = {
  name: string | null
  symbol: string | null
  description: string | null
  token: string
  curve: string
  creator: string
  blockNumber: string
  transactionHash: string
  metadataType: string
  metadataURI: string
  configId: string | null
  protocolVersion: string | null
}

type ApiData = {
  network: string
  chainId: number
  latestBlock: string
  total: number
  launches: Launch[]
  source: string
  fetchedAt: string
}

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, callback: (...args: unknown[]) => void) => void
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

const EXPLORER = 'https://sepolia-explorer.giwa.io'
const CHAIN_ID = 91342

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function App() {
  const [activeTab, setActiveTab] = useState('Overview')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedLaunch, setSelectedLaunch] = useState<Launch | null>(null)
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [wallet, setWallet] = useState('')
  const [walletError, setWalletError] = useState('')
  const [walletBusy, setWalletBusy] = useState(false)

  useEffect(() => {
    let alive = true

    async function loadLaunches() {
      try {
        const response = await fetch('/api/launches')
        if (!response.ok) throw new Error(`API returned ${response.status}`)
        const result: ApiData = await response.json()
        if (alive) {
          setData(result)
          setError('')
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Unknown API error')
      } finally {
        if (alive) setLoading(false)
      }
    }

    void loadLaunches()
    const interval = window.setInterval(loadLaunches, 30000)
    return () => {
      alive = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const provider = window.ethereum
    if (!provider?.on) return

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined
      setWallet(accounts?.[0] ?? '')
    }
    provider.on('accountsChanged', handleAccountsChanged)
    return () => provider.removeListener?.('accountsChanged', handleAccountsChanged)
  }, [])

  async function connectWallet() {
    setWalletError('')
    if (!window.ethereum) {
      setWalletError('No browser wallet detected. Install MetaMask or another EIP-1193 wallet.')
      return
    }

    setWalletBusy(true)
    try {
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[]
      setWallet(accounts?.[0] ?? '')

      const chainHex = (await window.ethereum.request({
        method: 'eth_chainId',
      })) as string

      const connectedChain = Number.parseInt(chainHex, 16)
      if (connectedChain !== CHAIN_ID) {
        setWalletError(`Wallet connected, but it is on chain ${connectedChain}. Switch to GIWA Sepolia (91342) in your wallet.`)
      }
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Wallet connection was rejected.')
    } finally {
      setWalletBusy(false)
    }
  }

  const launches = data?.launches ?? []
  const namedLaunches = launches.filter((launch) => launch.name || launch.symbol).length

  const filteredLaunches = useMemo(() => {
    const query = search.trim().toLowerCase()
    return launches.filter((launch) => {
      const matchesSearch =
        !query ||
        `${launch.name ?? ''} ${launch.symbol ?? ''} ${launch.token} ${launch.creator}`
          .toLowerCase()
          .includes(query)

      const matchesTab =
        activeTab !== 'My Launches' ||
        (!!wallet && launch.creator.toLowerCase() === wallet.toLowerCase())

      return matchesSearch && matchesTab
    })
  }, [launches, search, activeTab, wallet])

  function openExplorer(path: string) {
    window.open(`${EXPLORER}/${path}`, '_blank', 'noopener,noreferrer')
  }

  function copyValue(value: string) {
    void navigator.clipboard.writeText(value)
  }

  const navItems = [
    ['◈', 'Overview'],
    ['⌕', 'Explore'],
    ['＋', 'Create Launch'],
    ['▤', 'My Launches'],
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setActiveTab('Overview')}>
          <span className="brand-mark">N</span>
          <span>Nova<span className="brand-light">Launch</span></span>
        </a>

        <div className="network-status">
          <span className="status-dot" />
          <span>GIWA Sepolia</span>
          <span className="network-arrow">⌄</span>
        </div>

        <div className="nav-label">PLATFORM</div>
        <nav className="navigation">
          {navItems.map(([icon, label]) => (
            <button
              key={label}
              className={`nav-item ${activeTab === label ? 'active' : ''}`}
              onClick={() => {
                if (label === 'Create Launch') {
                  setShowCreate(true)
                } else {
                  setActiveTab(label)
                }
              }}
            >
              <span className="nav-icon">{icon}</span>
              {label}
              {label === 'Create Launch' && <span className="nav-plus">↗</span>}
            </button>
          ))}
        </nav>

        <div className="nav-label tools-label">TOOLS</div>
        <nav className="navigation">
          <button
            className={`nav-item ${activeTab === 'Analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('Analytics')}
          >
            <span className="nav-icon">▥</span>Analytics
          </button>
          <button
            className={`nav-item ${activeTab === 'Documentation' ? 'active' : ''}`}
            onClick={() => setActiveTab('Documentation')}
          >
            <span className="nav-icon">⌘</span>Documentation
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-help">
            <div className="help-icon">✦</div>
            <strong>Building on Ammora?</strong>
            <p>Explore the protocol and discover what's possible.</p>
            <a href="https://github.com/AmmoraLabs/ammora-examples" target="_blank" rel="noreferrer">
              Developer resources ↗
            </a>
          </div>
          <div className="sidebar-version">
            <span className="status-dot" />
            Testnet environment
            <span>v0.3.0</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Platform <span>/</span> {activeTab}</div>
          <div className="topbar-actions">
            <a className="explorer-link" href={EXPLORER} target="_blank" rel="noreferrer">
              Explorer ↗
            </a>
            <button className="wallet-button" onClick={connectWallet} disabled={walletBusy}>
              <span>◉</span>
              {walletBusy ? 'Connecting…' : wallet ? shortAddress(wallet) : 'Connect Wallet'}
            </button>
          </div>
        </header>

        <div className="page-container">
          {walletError && <div className="demo-notice">{walletError}</div>}

          {activeTab === 'Overview' && (
            <>
              <section className="welcome-section">
                <div>
                  <div className="eyebrow"><span className="eyebrow-line" />AMMORA ECOSYSTEM</div>
                  <h1>Launch the <span>next big thing.</span></h1>
                  <p className="welcome-description">
                    Discover real token launches, explore on-chain activity and build your own ecosystem with Ammora.
                  </p>
                  <div className="welcome-actions">
                    <button className="primary-button" onClick={() => setShowCreate(true)}>
                      <span>＋</span> Create a Launch
                    </button>
                    <button className="secondary-button" onClick={() => setActiveTab('Explore')}>
                      Explore projects <span>→</span>
                    </button>
                  </div>
                </div>
                <div className="hero-art">
                  <div className="hero-orbit orbit-one" />
                  <div className="hero-orbit orbit-two" />
                  <div className="hero-core"><span>N</span></div>
                  <div className="hero-node node-one">◈</div>
                  <div className="hero-node node-two">✦</div>
                  <div className="hero-node node-three">↗</div>
                  <div className="hero-glow" />
                </div>
              </section>

              <section className="stats-grid">
                <div className="stat-card">
                  <div className="stat-top"><span>Indexed Launches</span><span className="stat-icon">◈</span></div>
                  <div className="stat-value">{loading ? '...' : data?.total ?? '—'}</div>
                  <div className="stat-caption">Factory events in scanned block range</div>
                </div>
                <div className="stat-card">
                  <div className="stat-top"><span>Named Projects</span><span className="stat-icon">✦</span></div>
                  <div className="stat-value">{loading ? '...' : namedLaunches}</div>
                  <div className="stat-caption">Projects with readable metadata</div>
                </div>
                <div className="stat-card">
                  <div className="stat-top"><span>Latest Block</span><span className="stat-icon">↗</span></div>
                  <div className="stat-value">
                    {data?.latestBlock ? Number(data.latestBlock).toLocaleString() : '—'}
                  </div>
                  <div className="stat-caption">Latest RPC block observed</div>
                </div>
                <div className="stat-card network-card">
                  <div className="stat-top"><span>Network Status</span><span className="stat-icon green">●</span></div>
                  <div className="stat-value network-value">{data?.network ?? 'GIWA Sepolia'}</div>
                  <div className="stat-caption"><span className="status-dot" />Chain ID {data?.chainId ?? CHAIN_ID}</div>
                </div>
              </section>
              <LaunchSection
                launches={filteredLaunches.slice(0, 6)}
                loading={loading}
                error={error}
                search={search}
                setSearch={setSearch}
                onSelect={setSelectedLaunch}
                onExplore={() => setActiveTab('Explore')}
              />
            </>
          )}

          {activeTab === 'Explore' && (
            <LaunchSection
              launches={filteredLaunches}
              loading={loading}
              error={error}
              search={search}
              setSearch={setSearch}
              onSelect={setSelectedLaunch}
              onExplore={() => setSearch('')}
              title="Explore all launches"
            />
          )}

          {activeTab === 'My Launches' && (
            <section className="launch-section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">YOUR ON-CHAIN ACTIVITY</div>
                  <h2>My Launches</h2>
                  <p>Launch events where the connected wallet is recorded as creator.</p>
                </div>
              </div>
              {!wallet ? (
                <div className="empty-state">
                  Connect your wallet to find launches created by its address.
                </div>
              ) : (
                <LaunchSection
                  launches={filteredLaunches}
                  loading={loading}
                  error={error}
                  search={search}
                  setSearch={setSearch}
                  onSelect={setSelectedLaunch}
                  onExplore={() => setSearch('')}
                  hideHeading
                />
              )}
            </section>
          )}

          {activeTab === 'Analytics' && (
            <section className="launch-section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">NETWORK OVERVIEW</div>
                  <h2>On-chain Analytics</h2>
                  <p>Metrics calculated from the LaunchCreated events currently indexed by NovaLaunch.</p>
                </div>
              </div>
              <div className="stats-grid">
                <Metric label="Indexed events" value={loading ? '…' : launches.length} />
                <Metric label="Named projects" value={loading ? '…' : namedLaunches} />
                <Metric label="Unnamed metadata" value={loading ? '…' : launches.length - namedLaunches} />
                <Metric label="Unique creators" value={loading ? '…' : new Set(launches.map((item) => item.creator.toLowerCase())).size} />
              </div>
              <div className="demo-notice">
                These are event-indexing metrics, not token market capitalization, trading volume, liquidity or performance data.
              </div>
              <p className="stat-caption">
                Data source: {data?.source ?? 'Waiting for API'} · Last fetched: {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : '—'}
              </p>
            </section>
          )}

          {activeTab === 'Documentation' && (
            <section className="launch-section">
              <div className="eyebrow">BUILD WITH AMMORA</div>
              <h2>Documentation & developer resources</h2>
              <p className="welcome-description">
                NovaLaunch reads LaunchCreated events from the Ammora Factory on GIWA Sepolia.
                Use the official resources below to inspect the protocol and its examples.
              </p>
              <div className="welcome-actions">
                <a className="primary-button" href="https://github.com/AmmoraLabs/ammora-examples" target="_blank" rel="noreferrer">
                  Ammora examples ↗
                </a>
                <a className="secondary-button" href={EXPLORER} target="_blank" rel="noreferrer">
                  GIWA Sepolia Explorer ↗
                </a>
              </div>
              <div className="demo-notice">
                Launch creation is intentionally not enabled in this build. It requires verified SDK parameters, wallet flow and a successful testnet deployment check.
              </div>
            </section>
          )}

          <footer className="footer">
            <span>© 2026 NovaLaunch. Built for the Ammora ecosystem.</span>
            <span>Powered by <strong>Ammora SDK</strong> · GIWA Sepolia</span>
          </footer>
        </div>
      </main>

      {selectedLaunch && (
        <div className="modal-backdrop" onClick={() => setSelectedLaunch(null)}>
          <div className="create-modal details-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedLaunch(null)}>×</button>
            <div className="eyebrow">AMMORA · ON-CHAIN DETAILS</div>
            <h2>{selectedLaunch.name || 'Unnamed Token'}</h2>
            <p>{selectedLaunch.symbol ? `$${selectedLaunch.symbol}` : 'Symbol unavailable'}</p>
            <div className="modal-network"><span className="status-dot" />GIWA Sepolia · On-chain event</div>
            <div className="detail-list">
              {[
                ['Token Address', selectedLaunch.token],
                ['Creator Address', selectedLaunch.creator],
                ['Bonding Curve', selectedLaunch.curve],
                ['Transaction Hash', selectedLaunch.transactionHash],
                ['Block Number', selectedLaunch.blockNumber],
                ['Protocol Version', `V${selectedLaunch.protocolVersion || '—'}`],
                ['Config ID', selectedLaunch.configId || '—'],
                ['Metadata Type', selectedLaunch.metadataType],
              ].map(([label, value]) => (
                <div className="detail-row" key={label}>
                  <span>{label}</span>
                  <div>
                    <strong title={value}>{value}</strong>
                    <button type="button" onClick={() => copyValue(value)}>Copy</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="welcome-actions">
              <button className="primary-button" onClick={() => openExplorer(`address/${selectedLaunch.token}`)}>View Token ↗</button>
              <button className="secondary-button" onClick={() => openExplorer(`tx/${selectedLaunch.transactionHash}`)}>View Transaction ↗</button>
            </div>
            <p className="demo-notice">
              On-chain creation does not guarantee token safety, liquidity or trading availability.
            </p>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="create-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            <div className="eyebrow">NOVA LAUNCHPAD</div>
            <h2>Create your launch</h2>
            <p>
              Launch deployment is not enabled yet. This form is a preview only; it will not submit a transaction or create a token.
            </p>
            <label>Token name<input placeholder="e.g. Nova Protocol" /></label>
            <label>Token symbol<input placeholder="e.g. NOVA" /></label>
            <label>Description<textarea placeholder="Describe your project..." rows={3} /></label>
            <div className="modal-network"><span className="status-dot" />GIWA Sepolia · Testnet</div>
            <button className="primary-button modal-submit" onClick={() => alert('Preview only. No transaction was sent.')}>
              Preview only · Deployment disabled
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-card">
      <div className="stat-top"><span>{label}</span><span className="stat-icon">◈</span></div>
      <div className="stat-value">{value}</div>
      <div className="stat-caption">Based on indexed factory events</div>
    </div>
  )
}

function LaunchSection({
  launches,
  loading,
  error,
  search,
  setSearch,
  onSelect,
  onExplore,
  title = 'Explore launches',
  hideHeading = false,
}: {
  launches: Launch[]
  loading: boolean
  error: string
  search: string
  setSearch: (value: string) => void
  onSelect: (launch: Launch) => void
  onExplore: () => void
  title?: string
  hideHeading?: boolean
}) {
  return (
    <section className="launch-section">
      {!hideHeading && (
        <div className="section-heading">
          <div>
            <div className="eyebrow">ON-CHAIN DATA</div>
            <h2>{title}</h2>
            <p>Real launch creation events from the Ammora Factory.</p>
          </div>
          <button className="view-all" onClick={onExplore}>Reset view <span>→</span></button>
        </div>
      )}
      <div className="launch-toolbar">
        <div className="filter-tabs">
          <button className="selected" onClick={onExplore}>All Launches</button>
          <button onClick={() => setSearch('')}>Reset Search</button>
        </div>
        <label className="search-box">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, symbol or address..." />
        </label>
      </div>
      {error && <div className="demo-notice">API connection error: {error}</div>}
      <div className="launch-grid">
        {launches.map((launch, index) => (
          <article className="launch-card" key={launch.token}>
            <div className="launch-card-top">
              <div className={`token-avatar ${['purple', 'blue', 'pink'][index % 3]}`}>
                {(launch.symbol || launch.name || '?').slice(0, 1).toUpperCase()}
              </div>
              <span className="live-badge"><span />On-chain</span>
            </div>
            <h3>{launch.name || 'Unnamed Token'}</h3>
            <div className="token-symbol">{launch.symbol ? `$${launch.symbol}` : 'Symbol unavailable'}</div>
            <p className="launch-description">{launch.description || 'No description provided in metadata.'}</p>
            <div className="launch-metrics">
              <div><span>Block</span><strong>{Number(launch.blockNumber).toLocaleString()}</strong></div>
              <div><span>Protocol</span><strong>V{launch.protocolVersion || '—'}</strong></div>
            </div>
            <div className="launch-metrics">
              <div><span>Metadata</span><strong>{launch.metadataType}</strong></div>
              <div><span>Config ID</span><strong>{launch.configId || '—'}</strong></div>
            </div>
            <button className="card-button" onClick={() => onSelect(launch)}>View details <span>→</span></button>
          </article>
        ))}
        {loading && <div className="empty-state">Loading live Ammora launch data...</div>}
        {!loading && launches.length === 0 && (
          <div className="empty-state">No matching launches found.</div>
        )}
      </div>
      <div className="demo-notice">
        <span>ⓘ</span> Data is sourced from GIWA Sepolia Factory LaunchCreated events. On-chain creation does not imply token safety, liquidity or trading availability.
      </div>
    </section>
  )
}

export default App
