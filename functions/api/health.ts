import { giwaSepoliaAutoRouteDeployment as deployment } from '@ammora-protocol/sdk'

export async function onRequest() {
  return Response.json({
    status: 'ok',
    network: deployment.chain.name,
    chainId: Number(deployment.chain.id),
  })
}