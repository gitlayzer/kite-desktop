import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ClusterProvider } from './cluster-context'
import { useCluster } from '@/hooks/use-cluster'

const { mockRefetchClusters } = vi.hoisted(() => ({
  mockRefetchClusters: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  useCurrentClusterList: () => ({
    refetch: mockRefetchClusters,
  }),
}))

function ClusterConsumer() {
  const { currentCluster } = useCluster()
  return <div data-testid="current-cluster">{currentCluster}</div>
}

function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ClusterProvider>
        <ClusterConsumer />
      </ClusterProvider>
    </QueryClientProvider>
  )
}

describe('ClusterProvider', () => {
  it('restores a healthy stored cluster after restart', async () => {
    localStorage.setItem('current-cluster', 'usw-1')
    mockRefetchClusters.mockResolvedValue({
      data: [
        {
          name: 'c3vjdl7g@sealos',
          version: 'v1.33.6',
          isDefault: true,
          defaultNamespace: 'ns-38cq5qwz',
        },
        {
          name: 'usw-1',
          version: 'v1.33.6',
          isDefault: false,
          defaultNamespace: 'default',
        },
      ],
    })

    renderProvider()

    await waitFor(() => {
      expect(screen.getByTestId('current-cluster')).toHaveTextContent('usw-1')
    })
    expect(localStorage.getItem('current-cluster')).toBe('usw-1')
  })

  it('clears an unhealthy stored cluster without auto-entering another cluster', async () => {
    localStorage.setItem('current-cluster', 'orbstack')
    mockRefetchClusters.mockResolvedValue({
      data: [
        {
          name: 'c3vjdl7g@sealos',
          version: 'v1.33.6',
          isDefault: true,
          defaultNamespace: 'ns-38cq5qwz',
        },
        {
          name: 'orbstack',
          version: '',
          isDefault: false,
          error: 'connection refused',
          defaultNamespace: 'default',
        },
      ],
    })

    renderProvider()

    await waitFor(() => {
      expect(screen.getByTestId('current-cluster')).toBeEmptyDOMElement()
    })
    expect(localStorage.getItem('current-cluster')).toBeNull()
  })
})
