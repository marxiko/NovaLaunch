import { createPublicClient, http } from 'viem'
import {
  ammoraLaunchFactoryV4Abi,
  giwaSepoliaAutoRouteDeployment as deployment,
} from '@ammora-protocol/sdk'
import { createServer } from 'node:http'

const PORT = 8787
const RPC_URL = deployment.chain.rpcUrls[0]
const FACTORY = deployment.contracts.launch.factory
const START_BLOCK = deployment.startBlock
const CHUNK_SIZE = 9000n
const CACHE_MS = 30000

const client = createPublicClient({
  transport: http(RPC_URL),
})

const launchEvent = ammoraLaunchFactoryV4Abi.find(
  (item) => item.type === 'event' && item.name === 'LaunchCreated',
)

if (!launchEvent) {
  throw new Error('LaunchCreated event not found in Ammora SDK')
}

let cache = null
let cacheTime = 0
let loadingPromise = null

function parseMetadata(uri = '') {
  try {
    if (uri.startsWith('data:application/json;base64,')) {
      return JSON.parse(
        Buffer.from(uri.split(',')[1], 'base64').toString('utf8'),
      )
    }

    if (uri.startsWith('data:application/json;utf8,')) {
      return JSON.parse(
        decodeURIComponent(uri.slice('data:application/json;utf8,'.length)),
      )
    }

    if (uri.startsWith('data:application/json,')) {
      return JSON.parse(
        decodeURIComponent(uri.slice('data:application/json,'.length)),
      )
    }
  } catch {
    return {}
  }

  return {}
}

async function getLaunches() {
  if (cache && Date.now() - cacheTime < CACHE_MS) {
    return cache
  }

  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = (async () => {
    try {
      const latestBlock = await client.getBlockNumber()

      const fromBlock =
        latestBlock - 100000n > START_BLOCK
          ? latestBlock - 100000n
          : START_BLOCK

      const logs = []

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

      const launches = logs.map((log) => {
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
          protocolVersion:
            log.args.protocolVersion?.toString() || null,
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
        (a, b) =>
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

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'GET') {
    res.writeHead(405)
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  if (req.url === '/api/health') {
    res.writeHead(200)
    res.end(JSON.stringify({
      status: 'ok',
      network: deployment.chain.name,
      chainId: Number(deployment.chain.id),
    }))
    return
  }

  if (req.url === '/api/launches') {
    try {
      const result = await getLaunches()

      res.writeHead(200)
      res.end(JSON.stringify(result))
    } catch (error) {
      console.error('Launch API error:', error)

      res.writeHead(502)
      res.end(JSON.stringify({
        error: 'Unable to retrieve launch data',
        message: error.message,
      }))
    }

    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`NovaLaunch API running at http://localhost:${PORT}`)
  console.log(`Factory: ${FACTORY}`)
})