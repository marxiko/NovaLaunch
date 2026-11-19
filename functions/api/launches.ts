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

const METADATA_CONCURRENCY = 2

// ========================================
// IPFS GATEWAYS
// ========================================

const IPFS_GATEWAYS = [
  'https://gold-tropical-fox-676.mypinata.cloud/ipfs/',
  'https://w3s.link/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://ipfs.filebase.io/ipfs/',
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
const metadataCache = new Map<
  string,
  {
    data: Record<string, any>
    expiresAt: number
  }
>()

const METADATA_CACHE_TTL = 5 * 60 * 1000

const MAX_METADATA_CACHE_ENTRIES = 500

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
      '[METADATA] Base64 parsing failed:',
      error,
    )

    return {}
  }
}

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
  'w3s.link',
  'nftstorage.link',
  'ipfs.filebase.io',
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
    console.log('[METADATA] Fetching:', url)

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(
        METADATA_TIMEOUT,
      ),
      headers: {
        Accept: 'application/json',
      },
    })

    console.log('[METADATA] Response:', {
      url,
      status: response.status,
      ok: response.ok,
      redirected: response.redirected,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
    })

    if (!response.ok) {
      console.error(
        '[METADATA] HTTP error:',
        response.status,
        url,
      )
      return {}
    }

    const contentLength = Number(
      response.headers.get('content-length') || 0,
    )

    if (contentLength > MAX_METADATA_SIZE) {
      console.error(
        '[METADATA] Content too large:',
        contentLength,
      )
      return {}
    }

    const text = await response.text()

    console.log('[METADATA] Body length:', text.length)

    if (text.length > MAX_METADATA_SIZE) {
      console.error(
        '[METADATA] Body exceeds size limit',
      )
      return {}
    }

    const result = parseJsonObject(text)

    if (!Object.keys(result).length) {
      console.error(
        '[METADATA] Invalid or empty JSON:',
        url,
      )
    }

    return result
  } catch (error) {
    console.error(
      '[METADATA] Fetch failed:',
      url,
      error,
    )

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

    // Check metadata cache

    const cached = metadataCache.get(uri)

    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.data
      }

      metadataCache.delete(uri)
    }

    let metadata: Record<string, any> = {}

    // Base64 JSON

    if (
      uri.startsWith(
        'data:application/json;base64,',
      )
    ) {
      metadata = parseBase64Metadata(uri)
    }

    // Inline JSON

    else if (
      uri.startsWith(
        'data:application/json;utf8,',
      ) ||
      uri.startsWith(
        'data:application/json,',
      )
    ) {
      metadata = parseInlineMetadata(uri)
    }

    // External metadata

    else {
      let urls: string[] = []

      if (uri.startsWith('ipfs://')) {
        urls = getIpfsUrls(uri)
      } else if (uri.startsWith('https://')) {
        urls = getExternalUrls(uri)
      } else {
        return {}
      }

      for (const url of urls) {
        metadata = await fetchMetadataJson(url)

        if (Object.keys(metadata).length > 0) {
          break
        }
      }
    }

    // Cache successful metadata only

    if (Object.keys(metadata).length > 0) {
      if (
        metadataCache.size >=
        MAX_METADATA_CACHE_ENTRIES
      ) {
        const oldestKey =
          metadataCache.keys().next().value

        if (oldestKey) {
          metadataCache.delete(oldestKey)
        }
      }

      metadataCache.set(uri, {
        data: metadata,
        expiresAt:
          Date.now() + METADATA_CACHE_TTL,
      })
    }

    return metadata
  } catch (error) {
    console.error(
      '[METADATA] Parser failed:',
      error,
    )

    return {}
  }
}
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
