import { createPublicClient, http } from 'viem'

import {
  ammoraLaunchFactoryV4Abi,
  giwaSepoliaAutoRouteDeployment as deployment,
} from '@ammora-protocol/sdk'

// ========================================
// CONFIGURATION
// ========================================

const client = createPublicClient({
  transport: http(
    'https://giwa-sepolia-testnet.api.pocket.network',
  ),
})

const FACTORY = deployment.contracts.launch.factory

const START_BLOCK = deployment.startBlock

const CHUNK_SIZE = 9000n

const CACHE_MS = 30000

const MAX_METADATA_SIZE = 100000

const METADATA_TIMEOUT = 7000

const METADATA_CONCURRENCY = 4

// ========================================
// IPFS GATEWAYS
// ========================================

const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
]

// ========================================
// EVENT
// ========================================

const launchEvent = ammoraLaunchFactoryV4Abi.find(
  (item) =>
    item.type === 'event' &&
    item.name === 'LaunchCreated',
)

if (!launchEvent) {
  throw new Error('LaunchCreated event not found')
}

// ========================================
// CACHE
// ========================================

let cache: any = null

let cacheTime = 0

let loadingPromise: Promise<any> | null = null

// ========================================
// METADATA HELPERS
// ========================================

function parseJsonObject(text: string) {
  const value = JSON.parse(text)

  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return {}
  }

  return value
}

// ========================================
// BASE64 METADATA
// ========================================

function parseBase64Metadata(uri: string) {
  try {
    const base64 = uri.slice(uri.indexOf(',') + 1)

    const binary = atob(base64)

    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    )

    const text = new TextDecoder().decode(bytes)

    return parseJsonObject(text)
  } catch (error) {
    console.error(
      'Metadata fetch failed:',
      url,
      error,
    )

    return {}
  }
}

// ========================================
// INLINE METADATA
// ========================================

function parseInlineMetadata(uri: string) {
  try {
    const json = uri.slice(uri.indexOf(',') + 1)

    return parseJsonObject(decodeURIComponent(json))
  } catch {
    return {}
  }
}

// ========================================
// IPFS URI
// ========================================

function getIpfsUrls(uri: string): string[] {
  const value = uri.replace(/^ipfs:\/\//, '')

  const normalized = value.replace(/^ipfs\//, '')

  const parts = normalized.split('/')

  const cid = parts.shift()

  if (
    !cid ||
    cid === '.' ||
    cid === '..' ||
    !/^[a-zA-Z0-9]+$/.test(cid)
  ) {
    return []
  }

  const path = parts.join('/')

  const suffix = path ? `/${path}` : ''

  return IPFS_GATEWAYS.map(
    (gateway) => `${gateway}${cid}${suffix}`,
  )
}

// ========================================
// HTTPS URL VALIDATION
// ========================================

function isAllowedMetadataHost(hostname: string) {
  const host = hostname.toLowerCase()

  const allowedHosts = [
    'ipfs.io',
    'gateway.pinata.cloud',
    'dweb.link',
  ]

  if (allowedHosts.includes(host)) {
    return true
  }

  if (
    host === 'mypinata.cloud' ||
    host.endsWith('.mypinata.cloud')
  ) {
    return true
  }

  return false
}

// ========================================
// EXTERNAL URLS
// ========================================

function getExternalUrls(uri: string): string[] {
  try {
    const parsed = new URL(uri)

    if (parsed.protocol !== 'https:') {
      return []
    }

    if (
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return []
    }

    if (!isAllowedMetadataHost(parsed.hostname)) {
      return []
    }

    const urls = [parsed.toString()]

    // Detect IPFS paths inside Pinata URLs

    const match = parsed.pathname.match(
      /^\/ipfs\/([a-zA-Z0-9]+)(\/.*)?$/,
    )

    if (match) {
      const cid = match[1]

      const suffix = match[2] || ''

      for (const gateway of IPFS_GATEWAYS) {
        urls.push(`${gateway}${cid}${suffix}`)
      }
    }

    return [...new Set(urls)]
  } catch {
    return []
  }
}

// ========================================
// FETCH JSON
// ========================================

async function fetchMetadataJson(url: string) {
  try {
    const response = await fetch(url, {
      method: 'GET',

      redirect: 'error',

      signal: AbortSignal.timeout(
        METADATA_TIMEOUT,
      ),

      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      return {}
    }

    const contentLength = Number(
      response.headers.get('content-length') || 0,
    )

    if (contentLength > MAX_METADATA_SIZE) {
      return {}
    }

    // Do not rely on Content-Type.
    // Some IPFS gateways return JSON using
    // application/octet-stream.

    const text = await response.text()

    if (text.length > MAX_METADATA_SIZE) {
      return {}
    }

    return parseJsonObject(text)
  } catch {
    return {}
  }
}

// ========================================
// MAIN METADATA PARSER
// ========================================

async function parseMetadata(uri = '') {
  try {
    if (!uri) {
      return {}
    }

    // Base64 JSON

    if (
      uri.startsWith(
        'data:application/json;base64,',
      )
    ) {
      return parseBase64Metadata(uri)
    }

    // Inline JSON

    if (
      uri.startsWith(
        'data:application/json;utf8,',
      ) ||
      uri.startsWith(
        'data:application/json,',
      )
    ) {
      return parseInlineMetadata(uri)
    }

    let urls: string[] = []

    // IPFS

    if (uri.startsWith('ipfs://')) {
      urls = getIpfsUrls(uri)
    }

    // HTTPS

    else if (uri.startsWith('https://')) {
      urls = getExternalUrls(uri)
    }

    // Unsupported URI

    else {
      return {}
    }

    // Try gateways sequentially

    for (const url of urls) {
      const metadata = await fetchMetadataJson(url)

      if (Object.keys(metadata).length > 0) {
        return metadata
      }
    }

    return {}
  } catch {
    return {}
  }
}

// ========================================
// CONCURRENCY LIMITER
// ========================================

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)

  let nextIndex = 0

  async function worker() {
    while (true) {
      const index = nextIndex++

      if (index >= items.length) {
        return
      }

      results[index] = await callback(items[index])
    }
  }

  const workers = Array.from(
    {
      length: Math.min(concurrency, items.length),
    },
    () => worker(),
  )

  await Promise.all(workers)

  return results
}

// ========================================
// GET LAUNCHES
// ========================================

async function getLaunches() {
  if (
    cache &&
    Date.now() - cacheTime < CACHE_MS
  ) {
    return cache
  }

  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    try {
      const latestBlock =
        await client.getBlockNumber()

      const fromBlock =
        latestBlock - 100000n > START_BLOCK
          ? latestBlock - 100000n
          : START_BLOCK

      const logs = []

      // Scan factory events in chunks

      for (
        let from = fromBlock;
        from <= latestBlock;
        from += CHUNK_SIZE
      ) {
        const to =
          from + CHUNK_SIZE - 1n > latestBlock
            ? latestBlock
            : from + CHUNK_SIZE - 1n

        const batch = await client.getLogs({
          address: FACTORY,
          event: launchEvent,
          fromBlock: from,
          toBlock: to,
        })

        logs.push(...batch)
      }

      // Process metadata with limited concurrency

      const launches = await mapWithConcurrency(
        logs,
        METADATA_CONCURRENCY,
        async (log: any) => {
          const uri = log.args.metadataURI || ''

          const metadata = await parseMetadata(uri)

          return {
            name: metadata.name || null,

            symbol: metadata.symbol || null,

            description:
              metadata.description || null,

            image: metadata.image || null,

            token: log.args.token,

            curve: log.args.curve,

            creator: log.args.creator,

            configId:
              log.args.configId?.toString() || null,

            protocolVersion:
              log.args.protocolVersion?.toString() ||
              null,

            metadataURI: uri,

            metadataType: uri.startsWith('data:')
              ? 'inline'
              : uri.startsWith('ipfs:')
                ? 'ipfs'
                : uri.startsWith('https:')
                  ? 'https'
                  : uri
                    ? 'other'
                    : 'empty',

            blockNumber:
              log.blockNumber?.toString() || null,

            transactionHash: log.transactionHash,
          }
        },
      )

      // Sort newest launches first

      launches.sort(
        (a: any, b: any) => {
          const blockA = BigInt(a.blockNumber || '0')

          const blockB = BigInt(b.blockNumber || '0')

          return blockA > blockB
            ? -1
            : blockA < blockB
              ? 1
              : 0
        },
      )

      // API response

      const result = {
        network: deployment.chain.name,

        chainId: Number(deployment.chain.id),

        factory: FACTORY,

        latestBlock: latestBlock.toString(),

        scannedFromBlock: fromBlock.toString(),

        total: launches.length,

        launches,

        source:
          'GIWA Sepolia Factory LaunchCreated events',

        fetchedAt: new Date().toISOString(),
      }

      cache = result

      cacheTime = Date.now()

      return result
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
}

// ========================================
// API HANDLER
// ========================================

export async function onRequest(
  context: { request: Request },
) {
  if (context.request.method !== 'GET') {
    return Response.json(
      {
        error: 'Method not allowed',
      },
      {
        status: 405,
      },
    )
  }

  try {
    const result = await getLaunches()

    return Response.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=15',
      },
    })
  } catch (error) {
    console.error(
      'Launch API error:',
      error,
    )

    return Response.json(
      {
        error: 'Unable to retrieve launch data',

        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 502,
      },
    )
  }
}