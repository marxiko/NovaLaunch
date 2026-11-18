import { createPublicClient, http } from 'viem'
import {
  ammoraLaunchFactoryV4Abi,
  giwaSepoliaAutoRouteDeployment as deployment,
} from '@ammora-protocol/sdk'

const client = createPublicClient({
  transport: http(deployment.chain.rpcUrls[0]),
})

const FACTORY = deployment.contracts.launch.factory
const START_BLOCK = deployment.startBlock
const CHUNK_SIZE = 9000n
const CACHE_MS = 30000

const launchEvent = ammoraLaunchFactoryV4Abi.find(
  (item) => item.type === 'event' && item.name === 'LaunchCreated',
)

if (!launchEvent) {
  throw new Error('LaunchCreated event not found')
}

let cache: any = null
let cacheTime = 0
let loadingPromise: Promise<any> | null = null

function parseMetadata(uri = '') {
  try {
    if (uri.startsWith('data:application/json;base64,')) {
      const binary = atob(uri.split(',')[1])
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
      return JSON.parse(new TextDecoder().decode(bytes))
    }

    if (
      uri.startsWith('data:application/json;utf8,') ||
      uri.startsWith('data:application/json,')
    ) {
      return JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)))
    }
  } catch {
    return {}
  }

  return {}
}

async function getLaunches() {
  if (cache && Date.now() - cacheTime < CACHE_MS) return cache
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    try {
      const latestBlock = await client.getBlockNumber()

      const fromBlock =
        latestBlock - 100000n > START_BLOCK
          ? latestBlock - 100000n
          : START_BLOCK

      const logs = []

      for (let from = fromBlock; from <= latestBlock; from += CHUNK_SIZE) {
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

      const launches = logs.map((log: any) => {
        const uri = log.args.metadataURI || ''
        const metadata = parseMetadata(uri)

        return {
          name: metadata.name || null,
          symbol: metadata.symbol || null,
          description: metadata.description || null,
          token: log.args.token,
          curve: log.args.curve,
          creator: log.args.creator,
          configId: log.args.configId?.toString() || null,
          protocolVersion: log.args.protocolVersion?.toString() || null,
          metadataURI: uri,
          metadataType: uri.startsWith('data:')
            ? 'inline'
            : uri.startsWith('ipfs:')
              ? 'ipfs'
              : uri.startsWith('http')
                ? 'http'
                : uri
                  ? 'other'
                  : 'empty',
          blockNumber: log.blockNumber?.toString() || null,
          transactionHash: log.transactionHash,
        }
      })

      launches.sort(
        (a: any, b: any) =>
          Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)),
      )

      const result = {
        network: deployment.chain.name,
        chainId: Number(deployment.chain.id),
        factory: FACTORY,
        latestBlock: latestBlock.toString(),
        scannedFromBlock: fromBlock.toString(),
        total: launches.length,
        launches,
        source: 'GIWA Sepolia Factory LaunchCreated events',
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

export async function onRequest(context: { request: Request }) {
  if (context.request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  try {
    return Response.json(await getLaunches())
  } catch (error) {
    console.error('Launch API error:', error)

    return Response.json(
      {
        error: 'Unable to retrieve launch data',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    )
  }
}